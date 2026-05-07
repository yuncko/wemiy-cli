import chalk from 'chalk';
import boxen from 'boxen';
import yoctoSpinner from 'yocto-spinner';
import { confirm } from '@clack/prompts';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { configManager } from '../config/config-manager.js';
import { getAgentTools, changeTracker, AGENT_TOOL_IDS } from '../lib/fs-tools-auto.js';
import { chatService } from '../chat/chat-base.js';
import {
    AGENT_MODES,
    DISCUSS_TOOL_IDS,
    buildAgentSystemPrompt,
    runAgentLoop,
    displayStep,
} from './agent-runtime.js';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 25;
const MAX_VERIFY_RETRIES = 3;

const PLANNING_PROMPT = `You are Wemiy Agent, an expert software planning assistant.
Given a task, create a clear, numbered step-by-step plan to accomplish it.

Rules:
- Each step should be a concrete, actionable action (not vague)
- Include exploration steps (reading files, searching code) before editing
- Include verification steps (running tests, builds) at the end
- Keep the plan concise: typically 3-8 steps
- Return ONLY the plan as a numbered list, nothing else

Format:
1. Step description
2. Step description
...`;

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

async function initAIService() {
    try {
        const config = configManager.getConfig();
        const provider = config?.provider || 'gemini';

        if (provider === 'openrouter') {
            const { OpenRouterProvider } = await import('../providers/openrouter-provider.js');
            return new OpenRouterProvider();
        } else if (provider === 'swiftrouter') {
            const { SwiftRouterProvider } = await import('../providers/swiftrouter-provider.js');
            return new SwiftRouterProvider();
        } else {
            const { GeminiProvider } = await import('../providers/gemini-provider.js');
            return new GeminiProvider();
        }
    } catch (error) {
        console.error(chalk.red(`\nFailed to initialize AI Service: ${error.message}`));
        console.log(chalk.yellow('Falling back to Gemini...'));
        const { GeminiProvider } = await import('../providers/gemini-provider.js');
        return new GeminiProvider();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Strip surrounding markdown code fences and pull out the numbered list. */
function normalizePlanText(planText) {
    if (!planText) return '';
    let text = planText.trim();
    const fence = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
    if (fence) text = fence[1].trim();
    const lines = text.split('\n');
    const numbered = lines.filter((l) => /^\s*\d+\./.test(l));
    return numbered.length > 0 ? numbered.join('\n') : text;
}

function displayPlan(task, planText) {
    const normalized = normalizePlanText(planText);
    const lines = normalized.split('\n');
    const stepCount = lines.filter((l) => /^\d+\./.test(l.trim())).length;

    console.log(boxen(
        `${chalk.bold('Goal:')} ${task}\n` +
        `${chalk.bold('Steps:')} ${stepCount}\n` +
        `${chalk.gray('─'.repeat(40))}\n` +
        lines.map((l) => `  ${l}`).join('\n'),
        {
            padding: 1,
            margin: { top: 1, bottom: 1 },
            borderStyle: 'round',
            borderColor: 'magenta',
            title: '📋 Wemiy Plan',
            titleAlignment: 'center',
        }
    ));
}

function displaySummary(report, verificationPassed) {
    const modified = report.filesModified.map((f) => path.relative(process.cwd(), f));
    const created = report.filesCreated.map((f) => path.relative(process.cwd(), f));
    const commands = report.commandsRun;

    let summaryText = '';

    if (created.length > 0) {
        summaryText += `${chalk.green.bold('Files Created:')}\n`;
        created.forEach((f) => { summaryText += `  ${chalk.green('+')} ${f}\n`; });
        summaryText += '\n';
    }

    if (modified.length > 0) {
        summaryText += `${chalk.yellow.bold('Files Modified:')}\n`;
        modified.forEach((f) => { summaryText += `  ${chalk.yellow('~')} ${f}\n`; });
        summaryText += '\n';
    }

    if (commands.length > 0) {
        summaryText += `${chalk.cyan.bold('Commands Executed:')}\n`;
        commands.forEach((c) => {
            const icon = c.success ? chalk.green('✔') : chalk.red('✖');
            summaryText += `  ${icon} ${c.command}\n`;
        });
        summaryText += '\n';
    }

    if (created.length === 0 && modified.length === 0 && commands.length === 0) {
        summaryText += chalk.gray('No changes were made.\n');
    }

    const verifyIcon = verificationPassed ? chalk.green('✔ Passed') : chalk.yellow('⚠ Skipped');
    summaryText += `${chalk.bold('Verification:')} ${verifyIcon}`;

    console.log(boxen(summaryText, {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: 'double',
        borderColor: 'cyan',
        title: '📊 Agent Summary',
        titleAlignment: 'center',
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: TASK PLANNING
// ─────────────────────────────────────────────────────────────────────────────

async function planTask(task, aiService) {
    const spinner = yoctoSpinner({ text: 'Generating task plan...', color: 'magenta' }).start();

    try {
        const messages = [
            { role: 'system', content: PLANNING_PROMPT },
            { role: 'user', content: task },
        ];

        const result = await aiService.sendMessage(messages, null, undefined, null);
        const planText = result.content || '';

        spinner.success('Plan generated');
        return normalizePlanText(planText) || planText.trim();
    } catch (error) {
        spinner.error(`Planning failed: ${error.message}`);
        return `1. Explore the project structure\n2. Execute the task: ${task}\n3. Verify the changes`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

async function verifyChanges() {
    displayStep('Verification', '🔍', 'cyan', 'Checking project health...');

    const verifyCommands = [];

    try {
        await fs.access(path.join(process.cwd(), 'package.json'));
        try {
            const pkgRaw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
            const pkg = JSON.parse(pkgRaw);
            const scripts = pkg.scripts || {};

            if (scripts.lint) verifyCommands.push('npm run lint');
            if (scripts.typecheck || scripts['type-check']) {
                verifyCommands.push(scripts.typecheck ? 'npm run typecheck' : 'npm run type-check');
            }
            if (scripts.build) verifyCommands.push('npm run build');
            if (scripts.test && !scripts.test.includes('no test specified')) {
                verifyCommands.push('npm test');
            }
        } catch {
            // ignore parse error
        }
    } catch {
        // not a Node project
    }

    try {
        await fs.access(path.join(process.cwd(), 'tsconfig.json'));
        if (!verifyCommands.some((c) => c.includes('tsc'))) {
            verifyCommands.push('npx tsc --noEmit');
        }
    } catch {
        // no tsconfig
    }

    if (verifyCommands.length === 0) {
        console.log(chalk.gray('  No verification commands detected — skipping verification.'));
        return true;
    }

    console.log(chalk.gray(`  Running ${verifyCommands.length} verification command(s)...\n`));

    let allPassed = true;

    for (const cmd of verifyCommands) {
        const spinner = yoctoSpinner({ text: `Running: ${cmd}...` }).start();

        try {
            await execAsync(cmd, { cwd: process.cwd(), timeout: 120000 });
            spinner.success(chalk.green(`${cmd} ✔`));
        } catch (error) {
            spinner.error(chalk.red(`${cmd} ✖`));
            allPassed = false;

            if (error.stdout) console.log(chalk.gray(error.stdout.substring(0, 500)));
            if (error.stderr) console.log(chalk.yellow(error.stderr.substring(0, 500)));
        }
    }

    return allPassed;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERER (lazy import to avoid load cost on simple commands)
// ─────────────────────────────────────────────────────────────────────────────

let _markedRender = null;
async function getMarkedRender() {
    if (_markedRender) return _markedRender;
    try {
        const { marked } = await import('../chat/chat-base.js');
        _markedRender = (text) => console.log(marked.parse(text));
    } catch {
        _markedRender = (text) => console.log(text);
    }
    return _markedRender;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full Wemiy Agent pipeline: plan → execute → verify → summarize.
 *
 * @param {string} task
 * @param {Object} options
 * @param {boolean} [options.autoApprove]
 * @param {number}  [options.maxIterations]
 * @param {string}  [options.mode] - 'act' (default) or 'discuss'
 * @param {boolean} [options.confirmPlan] - prompt before execution (default: true unless autoApprove)
 * @param {string}  [options.conversationId] - resume an existing chat history
 */
export async function runAgent(task, options = {}) {
    const autoApprove = !!options.autoApprove;
    const maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
    const mode = options.mode || AGENT_MODES.ACT;
    const confirmPlan = options.confirmPlan ?? !autoApprove;

    console.log(boxen(
        chalk.bold.magenta('🤖 Wemiy Agent\n\n') +
        chalk.gray(mode === AGENT_MODES.DISCUSS
            ? 'Project Discussion — Read → Understand → Explain'
            : 'Autonomous Developer Agent — Plan → Act → Verify → Report'),
        {
            padding: 1,
            borderStyle: 'double',
            borderColor: 'magenta',
        }
    ));

    console.log(chalk.cyan(`\n📂 Working Directory: ${chalk.bold(process.cwd())}`));
    const toolList = mode === AGENT_MODES.DISCUSS ? DISCUSS_TOOL_IDS : AGENT_TOOL_IDS;
    console.log(chalk.cyan(`🔧 Tools: ${toolList.join(', ')}`));
    console.log(chalk.cyan(`🔄 Max Iterations: ${maxIterations}`));
    console.log(chalk.cyan(`🎛️  Mode: ${mode}`));

    if (autoApprove) {
        console.log(boxen(
            chalk.yellow.bold('⚡ AUTO-APPROVE MODE\n\n') +
            chalk.yellow('File edits and command execution will proceed without confirmation.'),
            { padding: 1, borderStyle: 'round', borderColor: 'yellow', title: '⚠️  Warning' }
        ));
    }

    const aiService = await initAIService();
    const renderText = await getMarkedRender();

    // ── Discussion mode: skip plan/verify, go straight to a thinking loop ──
    if (mode === AGENT_MODES.DISCUSS) {
        return await runDiscussionMode({
            task,
            aiService,
            renderText,
            maxIterations,
            conversationId: options.conversationId,
        });
    }

    // ── Phase 1: Planning ────────────────────────────────────────────────
    displayStep('Phase 1', '📋', 'magenta', 'Task Planning');
    const plan = await planTask(task, aiService);
    displayPlan(task, plan);

    if (confirmPlan) {
        const proceed = await confirm({
            message: chalk.cyan('Proceed with this plan?'),
            initialValue: true,
        });
        if (proceed === false) {
            console.log(chalk.yellow('\n👋 Plan rejected. Agent stopped before execution.\n'));
            return;
        }
    }

    // ── Phase 2: Execution ───────────────────────────────────────────────
    displayStep('Phase 2', '⚡', 'cyan', 'Execution');

    changeTracker.reset();

    // Use the auto-approve aware tool factory; this is the only path that wires
    // the change tracker into every edit and command call.
    const tools = getAgentTools(autoApprove);

    // Optionally hydrate prior conversation history for follow-up tasks
    const messages = await buildExecutionMessages({
        mode: AGENT_MODES.ACT,
        task,
        plan,
        conversationId: options.conversationId,
    });

    const { finalResponse: agentResponse } = await runAgentLoop({
        aiService,
        messages,
        tools,
        maxIterations,
        renderText,
    });

    // Persist the turn so future invocations can resume context
    if (options.conversationId) {
        try {
            await chatService.addMessage(options.conversationId, 'user', task);
            await chatService.addMessage(
                options.conversationId,
                'assistant',
                agentResponse || '(Agent completed task with tool calls only)'
            );
        } catch (error) {
            console.log(chalk.yellow(`\n⚠️  Could not persist agent turn: ${error.message}`));
        }
    }

    // ── Phase 3: Verification ───────────────────────────────────────────
    displayStep('Phase 3', '🔍', 'green', 'Verification');

    const report = changeTracker.getReport();
    let verificationPassed = true;
    // Track total iterations across the verification retry loop
    let iterationBudgetLeft = Math.max(0, maxIterations - 1); // leave a small floor

    if (report.filesModified.length > 0 || report.filesCreated.length > 0) {
        verificationPassed = await verifyChanges();

        if (!verificationPassed) {
            console.log(chalk.yellow('\n⚠️  Verification failed. The agent will attempt to fix issues...\n'));

            for (let retry = 0; retry < MAX_VERIFY_RETRIES && iterationBudgetLeft > 0; retry++) {
                displayStep(`Fix Attempt ${retry + 1}/${MAX_VERIFY_RETRIES}`, '🔧', 'yellow');

                const fixBudget = Math.min(10, iterationBudgetLeft);
                const fixMessages = await buildExecutionMessages({
                    mode: AGENT_MODES.ACT,
                    task: 'The verification step failed. Read the errors above and fix the code so that all checks pass.',
                    plan: 'Fix the verification errors',
                    conversationId: options.conversationId,
                });

                const { iterationsUsed } = await runAgentLoop({
                    aiService,
                    messages: fixMessages,
                    tools,
                    maxIterations: fixBudget,
                    renderText,
                });

                iterationBudgetLeft -= iterationsUsed;
                verificationPassed = await verifyChanges();
                if (verificationPassed) {
                    console.log(chalk.green('\n✅ Verification passed after fix!\n'));
                    break;
                }
            }
        }
    } else {
        console.log(chalk.gray('  No file changes to verify.'));
    }

    // ── Phase 4: Summary ────────────────────────────────────────────────
    displayStep('Phase 4', '📊', 'cyan', 'Summary');

    const finalReport = changeTracker.getReport();
    displaySummary(finalReport, verificationPassed);

    if (agentResponse && agentResponse.trim()) {
        const trimmed = agentResponse.length > 1000
            ? agentResponse.substring(0, 1000) + chalk.gray('\n... (truncated; see scrollback for full response)')
            : agentResponse;
        console.log(boxen(chalk.white(trimmed), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'green',
            title: '🤖 Agent Response',
        }));
    }

    console.log(chalk.green.bold('\n✨ Agent task complete!\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCUSSION MODE — read-only, conversational
// ─────────────────────────────────────────────────────────────────────────────

async function runDiscussionMode({ task, aiService, renderText, maxIterations, conversationId }) {
    const allTools = getAgentTools(false);
    const tools = {};
    for (const id of DISCUSS_TOOL_IDS) {
        if (allTools[id]) tools[id] = allTools[id];
    }

    const messages = await buildExecutionMessages({
        mode: AGENT_MODES.DISCUSS,
        task,
        plan: null,
        conversationId,
    });

    const { finalResponse } = await runAgentLoop({
        aiService,
        messages,
        tools,
        maxIterations,
        renderText,
    });

    if (conversationId) {
        try {
            await chatService.addMessage(conversationId, 'user', task);
            await chatService.addMessage(
                conversationId,
                'assistant',
                finalResponse || '(Discussion ended without a final summary)'
            );
        } catch (error) {
            console.log(chalk.yellow(`\n⚠️  Could not persist discussion turn: ${error.message}`));
        }
    }

    if (finalResponse && finalResponse.trim()) {
        const trimmed = finalResponse.length > 1500
            ? finalResponse.substring(0, 1500) + chalk.gray('\n... (truncated)')
            : finalResponse;
        console.log(boxen(chalk.white(trimmed), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'magenta',
            title: '🗣️  Discussion Summary',
        }));
    }

    console.log(chalk.green.bold('\n✨ Discussion complete!\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE BUILDER — assemble system + (optional history) + current user
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HYDRATED_HISTORY = 30; // turns of prior context the agent reloads

async function buildExecutionMessages({ mode, task, plan, conversationId }) {
    const extra = plan
        ? `The user's task: ${task}\n\nYour plan:\n${plan}\n\nFollow this plan. Execute each step using the tools available to you. When done, provide a brief summary.`
        : `The user wants to discuss this project: ${task}`;

    const systemPrompt = buildAgentSystemPrompt(mode, extra);

    const messages = [{ role: 'system', content: systemPrompt }];

    if (conversationId) {
        try {
            const history = await chatService.getMessages(conversationId);
            const recent = history.slice(-MAX_HYDRATED_HISTORY);
            for (const m of recent) {
                if (m.role === 'user' || m.role === 'assistant') {
                    messages.push({
                        role: m.role,
                        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                    });
                }
            }
        } catch {
            // best-effort; missing history is not fatal
        }
    }

    messages.push({ role: 'user', content: task });
    return messages;
}
