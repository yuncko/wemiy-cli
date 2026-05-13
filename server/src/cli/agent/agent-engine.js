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
import { collectProjectBrief } from '../lib/agent-project-brief.js';
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
const VERIFY_OUTPUT_CAP = 48000;

async function fsExists(p) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

function truncateVerifyChunk(text) {
    if (text == null || typeof text !== 'string') return '';
    if (text.length <= VERIFY_OUTPUT_CAP) return text;
    return '...(head truncated)\n' + text.slice(-VERIFY_OUTPUT_CAP);
}

/**
 * @param {{ filesModified: string[], filesCreated: string[], commandsRun: { command: string, success: boolean }[] }} report
 */
function formatAgentResumeNote(report) {
    const cwd = process.cwd();
    const mods = report.filesModified.map((f) => path.relative(cwd, f)).slice(0, 30);
    const adds = report.filesCreated.map((f) => path.relative(cwd, f)).slice(0, 20);
    const cmds = report.commandsRun.slice(-12).map((c) => `${c.success ? 'ok' : 'fail'}:${c.command}`).join('; ');
    return `\n\n---\n**Agent session:** files_modified=${mods.join(', ') || 'none'}; files_created=${adds.join(', ') || 'none'}; recent_commands=${cmds || 'none'}`;
}

async function detectPackageRunner(cwd = process.cwd()) {
    const pkgPath = path.join(cwd, 'package.json');
    if (!(await fsExists(pkgPath))) return null;
    let pm = 'npm';
    try {
        const raw = await fs.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(raw);
        const spec = pkg.packageManager;
        if (typeof spec === 'string') {
            if (spec.startsWith('pnpm')) pm = 'pnpm';
            else if (spec.startsWith('yarn')) pm = 'yarn';
            else if (spec.startsWith('bun')) pm = 'bun';
        }
    } catch {
        /* invalid package.json; keep default pm */
    }
    if (await fsExists(path.join(cwd, 'pnpm-lock.yaml'))) pm = 'pnpm';
    else if (await fsExists(path.join(cwd, 'yarn.lock'))) pm = 'yarn';
    else if (await fsExists(path.join(cwd, 'bun.lockb'))) pm = 'bun';
    return pm;
}

function runPackageScript(pm, scriptName) {
    if (pm === 'pnpm') return `pnpm run ${scriptName}`;
    if (pm === 'yarn') return `yarn run ${scriptName}`;
    if (pm === 'bun') return `bun run ${scriptName}`;
    return `npm run ${scriptName}`;
}

/**
 * Build verification shell commands for the current workspace.
 * @param {string} [cwd]
 * @returns {Promise<string[]>}
 */
async function collectVerifyCommands(cwd = process.cwd()) {
    const overridePath = path.join(cwd, '.wemiy', 'agent-verify.json');
    try {
        const raw = await fs.readFile(overridePath, 'utf8');
        const j = JSON.parse(raw);
        if (Array.isArray(j.commands) && j.commands.length > 0 && j.commands.every((c) => typeof c === 'string')) {
            return j.commands.map((c) => c.trim()).filter(Boolean);
        }
    } catch {
        /* no override */
    }

    const commands = [];
    const pm = await detectPackageRunner(cwd);
    const pkgPath = path.join(cwd, 'package.json');

    if (pm && (await fsExists(pkgPath))) {
        try {
            const pkgRaw = await fs.readFile(pkgPath, 'utf8');
            const pkg = JSON.parse(pkgRaw);
            const scripts = pkg.scripts || {};

            if (scripts.lint) commands.push(runPackageScript(pm, 'lint'));
            if (scripts.typecheck || scripts['type-check']) {
                commands.push(runPackageScript(pm, scripts.typecheck ? 'typecheck' : 'type-check'));
            }
            if (scripts.build) commands.push(runPackageScript(pm, 'build'));
            if (scripts.test && !scripts.test.includes('no test specified')) {
                commands.push(runPackageScript(pm, 'test'));
            }
        } catch {
            /* ignore */
        }
    }

    if (await fsExists(path.join(cwd, 'tsconfig.json')) && !commands.some((c) => c.includes('tsc'))) {
        if (pm === 'pnpm') commands.push('pnpm exec tsc --noEmit');
        else if (pm === 'yarn') commands.push('yarn exec tsc --noEmit');
        else if (pm === 'bun') commands.push('bunx tsc --noEmit');
        else commands.push('npx tsc --noEmit');
    }

    if (await fsExists(path.join(cwd, 'go.mod'))) {
        commands.push('go test ./...');
    }
    if (await fsExists(path.join(cwd, 'Cargo.toml'))) {
        commands.push('cargo check');
    }

    return commands;
}

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

async function planTask(task, aiService, projectBrief) {
    const spinner = yoctoSpinner({ text: 'Generating task plan...', color: 'magenta' }).start();

    try {
        const userContent = projectBrief
            ? `${projectBrief}\n\n---\nTask:\n${task}`
            : task;
        const messages = [
            { role: 'system', content: PLANNING_PROMPT },
            { role: 'user', content: userContent },
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

/**
 * Run configured verification commands and capture output for the model if anything fails.
 * @returns {Promise<{ ok: boolean, modelReport: string }>}
 */
async function verifyChanges() {
    displayStep('Verification', '🔍', 'cyan', 'Checking project health...');

    const verifyCommands = await collectVerifyCommands();

    if (verifyCommands.length === 0) {
        console.log(chalk.gray('  No verification commands detected — skipping verification.'));
        return { ok: true, modelReport: '' };
    }

    console.log(chalk.gray(`  Running ${verifyCommands.length} verification command(s)...\n`));

    let allPassed = true;
    const sections = [];

    for (const cmd of verifyCommands) {
        const spinner = yoctoSpinner({ text: `Running: ${cmd}...` }).start();

        try {
            await execAsync(cmd, { cwd: process.cwd(), timeout: 120000 });
            spinner.success(chalk.green(`${cmd} ✔`));
            sections.push(`### ${cmd}\nexit: 0\n(no output)`);
        } catch (error) {
            spinner.error(chalk.red(`${cmd} ✖`));
            allPassed = false;

            const out = truncateVerifyChunk(String(error.stdout || ''));
            const err = truncateVerifyChunk(String(error.stderr || ''));
            if (error.stdout) console.log(chalk.gray(String(error.stdout).substring(0, 500)));
            if (error.stderr) console.log(chalk.yellow(String(error.stderr).substring(0, 500)));

            sections.push(
                `### ${cmd}\nexit: ${error.code ?? 'non-zero'}\nstdout:\n${out}\nstderr:\n${err}`
            );
        }
    }

    return { ok: allPassed, modelReport: sections.join('\n\n') };
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

    const projectBrief = await collectProjectBrief();
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
            projectBrief,
        });
    }

    // ── Phase 1: Planning ────────────────────────────────────────────────
    displayStep('Phase 1', '📋', 'magenta', 'Task Planning');
    const plan = await planTask(task, aiService, projectBrief);
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
        projectBrief,
    });

    const { finalResponse: agentResponse } = await runAgentLoop({
        aiService,
        messages,
        tools,
        maxIterations,
        renderText,
    });

    // ── Phase 3: Verification ───────────────────────────────────────────
    displayStep('Phase 3', '🔍', 'green', 'Verification');

    const report = changeTracker.getReport();
    let verificationPassed = true;
    let lastVerifyReport = '';
    // Track total iterations across the verification retry loop
    let iterationBudgetLeft = Math.max(0, maxIterations - 1); // leave a small floor

    if (report.filesModified.length > 0 || report.filesCreated.length > 0) {
        let verificationResult = await verifyChanges();
        verificationPassed = verificationResult.ok;
        lastVerifyReport = verificationResult.modelReport;

        if (!verificationPassed) {
            console.log(chalk.yellow('\n⚠️  Verification failed. The agent will attempt to fix issues...\n'));

            for (let retry = 0; retry < MAX_VERIFY_RETRIES && iterationBudgetLeft > 0; retry++) {
                displayStep(`Fix Attempt ${retry + 1}/${MAX_VERIFY_RETRIES}`, '🔧', 'yellow');

                const fixBudget = Math.min(10, iterationBudgetLeft);
                const fixMessages = await buildExecutionMessages({
                    mode: AGENT_MODES.ACT,
                    task: 'Fix verification failures using the logs below. Make minimal changes so all checks pass.',
                    plan: 'Address each failing command shown in the verification output.',
                    conversationId: options.conversationId,
                    projectBrief,
                    verificationFailureReport: lastVerifyReport,
                });

                const { iterationsUsed } = await runAgentLoop({
                    aiService,
                    messages: fixMessages,
                    tools,
                    maxIterations: fixBudget,
                    renderText,
                });

                iterationBudgetLeft -= iterationsUsed;
                verificationResult = await verifyChanges();
                verificationPassed = verificationResult.ok;
                lastVerifyReport = verificationResult.modelReport;
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

    if (options.conversationId) {
        try {
            const note = formatAgentResumeNote(finalReport)
                + `\nverification: ${verificationPassed ? 'passed' : 'failed'}`;
            await chatService.addMessage(options.conversationId, 'user', task);
            await chatService.addMessage(
                options.conversationId,
                'assistant',
                (agentResponse || '(Agent completed task with tool calls only)') + note
            );
        } catch (error) {
            console.log(chalk.yellow(`\n⚠️  Could not persist agent turn: ${error.message}`));
        }
    }

    console.log(chalk.green.bold('\n✨ Agent task complete!\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCUSSION MODE — read-only, conversational
// ─────────────────────────────────────────────────────────────────────────────

async function runDiscussionMode({ task, aiService, renderText, maxIterations, conversationId, projectBrief }) {
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
        projectBrief,
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

/**
 * @param {Object} params
 * @param {string} params.mode
 * @param {string} params.task
 * @param {string|null} [params.plan]
 * @param {string|null} [params.conversationId]
 * @param {string} [params.projectBrief]
 * @param {string} [params.verificationFailureReport]
 */
async function buildExecutionMessages({
    mode,
    task,
    plan,
    conversationId,
    projectBrief = '',
    verificationFailureReport = '',
}) {
    let history = [];
    if (conversationId) {
        try {
            history = await chatService.getMessages(conversationId);
        } catch {
            history = [];
        }
    }

    let resumeHint = '';
    const lastAgent = [...history].reverse().find(
        (m) => m.role === 'assistant' && String(m.content).includes('**Agent session:**')
    );
    if (lastAgent) {
        const s = String(lastAgent.content);
        const i = s.indexOf('**Agent session:**');
        resumeHint = `## Prior agent session (from saved chat)\n${s.slice(i)}`;
    }

    const extraParts = [];
    if (projectBrief) {
        extraParts.push(`## Project brief (deterministic scan)\n${projectBrief}`);
    }
    if (resumeHint) {
        extraParts.push(resumeHint);
    }
    if (plan) {
        extraParts.push(
            `The user's task: ${task}\n\nYour plan:\n${plan}\n\nFollow this plan. Execute each step using the tools available to you. When done, provide a brief summary.`
        );
    } else {
        extraParts.push(`The user wants to discuss this project: ${task}`);
    }

    const systemPrompt = buildAgentSystemPrompt(mode, extraParts.join('\n\n'));

    const messages = [{ role: 'system', content: systemPrompt }];

    const recent = history.slice(-MAX_HYDRATED_HISTORY);
    for (const m of recent) {
        if (m.role === 'user' || m.role === 'assistant') {
            messages.push({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            });
        }
        if (m.role === 'tool') {
            const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            let parsed = null;
            try {
                parsed = JSON.parse(raw);
            } catch {
                parsed = null;
            }
            if (parsed && parsed.toolCallId && parsed.toolName) {
                const body = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
                messages.push({
                    role: 'tool',
                    toolCallId: parsed.toolCallId,
                    toolName: parsed.toolName,
                    content: body,
                });
            }
        }
    }

    let userContent = task;
    if (verificationFailureReport) {
        userContent = `## Automated verification output\n${verificationFailureReport}\n\n## Your instruction\n${task}`;
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
}
