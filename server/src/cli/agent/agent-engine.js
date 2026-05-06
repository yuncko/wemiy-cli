import chalk from 'chalk';
import boxen from 'boxen';
import yoctoSpinner from 'yocto-spinner';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { configManager } from '../config/config-manager.js';
import { getAgentTools, changeTracker, AGENT_TOOL_IDS } from '../lib/fs-tools-auto.js';
import { availableTools, enableTools, getEnabledTools, resetTools } from '../../config/tool.config.js';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Default max iterations for the agent loop */
const DEFAULT_MAX_ITERATIONS = 25;

/** Max retries for the verification-fix cycle */
const MAX_VERIFY_RETRIES = 3;

/** System prompt for the planning phase */
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

/** System prompt for the execution phase */
const EXECUTION_PROMPT = `You are Wemiy Agent, an autonomous AI developer inside a CLI tool.
You have access to tools that let you explore the workspace, read files, edit code, search for patterns, and execute shell commands.

You are running on Windows. Use Windows CMD commands only.
Never use: touch, mkdir -p, ls, cat, grep, rm -rf
Instead use: echo. >, mkdir, dir, type, findstr, del

Your workflow:
1. EXPLORE the project structure using list_dir to understand the codebase layout.
2. SEARCH for relevant code using grep_search to find definitions, usages, and patterns.
3. READ the relevant files using read_files to understand the exact code.
4. EDIT code using replace_content (preferred for targeted changes) or edit_file (for new files or full rewrites).
5. VERIFY your changes by running tests or build commands using execute_command.
6. If a command fails, READ the error output, FIX the issue, and try again.

Rules:
- Always explore and read before editing. Never guess file contents.
- Use replace_content for surgical edits (preferred). Use edit_file only for creating new files.
- After editing, verify your changes work by running relevant commands.
- If tests fail, read the error and fix the code. Keep iterating until it passes.
- Be concise in your explanations. Focus on doing, not describing what you would do.
- When your task is complete, provide a brief summary of what you did.

Tool argument format (always pass explicit arguments, never {}):
- list_dir: {"path":"."}
- execute_command: {"command":"dir"}
- read_files: {"filePaths":["src/index.js"]}
- grep_search: {"pattern":"sendMessage(", "path":"src"}
- replace_content: {"filePath":"src/file.js","targetContent":"old","replacementContent":"new"};`;

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the AI service based on user configuration.
 * @returns {Promise<Object>} The AI provider instance
 */
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

/**
 * Display a labeled step indicator in the terminal.
 */
function displayStep(label, emoji, color, detail = '') {
    const colorFn = chalk[color] || chalk.white;
    const detailStr = detail ? ` ${chalk.gray('→')} ${chalk.white(detail)}` : '';
    console.log(colorFn(`\n${emoji} [${label}]${detailStr}`));
}

/**
 * Display tool call information in a formatted box.
 */
function displayToolCall(toolCall) {
    const argsStr = JSON.stringify(toolCall.input || toolCall.args || {}, null, 2);
    const truncatedArgs = argsStr.length > 500 ? argsStr.substring(0, 500) + '\n  ...' : argsStr;

    const toolBox = boxen(
        `${chalk.cyan('Tool:')} ${chalk.bold(toolCall.name)}\n` +
        `${chalk.gray('Args:')} ${truncatedArgs}`,
        {
            padding: 1,
            margin: { left: 2 },
            borderStyle: 'round',
            borderColor: 'cyan',
            title: '🔧 Tool Call',
        }
    );
    console.log(toolBox);
}

/**
 * Display tool result in a formatted box.
 */
function displayToolResult(toolName, result) {
    const truncated = result.length > 800 ? result.substring(0, 800) + '\n...(truncated)' : result;
    const resultBox = boxen(
        `${chalk.green('Tool:')} ${toolName}\n${chalk.gray('─'.repeat(40))}\n${truncated}`,
        {
            padding: 1,
            margin: { left: 2 },
            borderStyle: 'round',
            borderColor: 'green',
            title: '📊 Result',
        }
    );
    console.log(resultBox);
}

/**
 * Display the task plan in a formatted box.
 */
function displayPlan(task, planText) {
    const lines = planText.trim().split('\n');
    const stepCount = lines.filter(l => /^\d+\./.test(l.trim())).length;

    const planBox = boxen(
        `${chalk.bold('Goal:')} ${task}\n` +
        `${chalk.bold('Steps:')} ${stepCount}\n` +
        `${chalk.gray('─'.repeat(40))}\n` +
        lines.map(l => `  ${l}`).join('\n'),
        {
            padding: 1,
            margin: { top: 1, bottom: 1 },
            borderStyle: 'round',
            borderColor: 'magenta',
            title: '📋 Wemiy Plan',
            titleAlignment: 'center',
        }
    );
    console.log(planBox);
}

/**
 * Display the final summary report.
 */
function displaySummary(report, verificationPassed) {
    const modified = report.filesModified.map(f => path.relative(process.cwd(), f));
    const created = report.filesCreated.map(f => path.relative(process.cwd(), f));
    const commands = report.commandsRun;

    let summaryText = '';

    if (created.length > 0) {
        summaryText += `${chalk.green.bold('Files Created:')}\n`;
        created.forEach(f => { summaryText += `  ${chalk.green('+')} ${f}\n`; });
        summaryText += '\n';
    }

    if (modified.length > 0) {
        summaryText += `${chalk.yellow.bold('Files Modified:')}\n`;
        modified.forEach(f => { summaryText += `  ${chalk.yellow('~')} ${f}\n`; });
        summaryText += '\n';
    }

    if (commands.length > 0) {
        summaryText += `${chalk.cyan.bold('Commands Executed:')}\n`;
        commands.forEach(c => {
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

    const summaryBox = boxen(summaryText, {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: 'double',
        borderColor: 'cyan',
        title: '📊 Agent Summary',
        titleAlignment: 'center',
    });
    console.log(summaryBox);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a tool by its ID and execute it with the given input.
 * @param {Object} tools - The tools map (toolId → tool instance)
 * @param {string} toolName - The tool ID/name
 * @param {Object} toolInput - Arguments to pass to the tool
 * @returns {Promise<string>} The tool execution result as a string
 */
async function executeTool(toolName, toolInput) {
    const toolConfig = availableTools.find(t => t.id === toolName);
    if (!toolConfig) {
        return `Error: Tool "${toolName}" not found. Available tools: ${AGENT_TOOL_IDS.join(', ')}`;
    }

    try {
        const toolInstance = toolConfig.getTool();
        if (toolInstance.execute) {
            return await toolInstance.execute(toolInput);
        }
        return `Error: Tool "${toolName}" does not have an execute method.`;
    } catch (error) {
        return `Error executing tool "${toolName}": ${error.message}`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: TASK PLANNING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a step-by-step plan for the given task.
 * @param {string} task - The user's task description
 * @param {Object} aiService - The AI provider instance
 * @returns {Promise<string>} The plan text
 */
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
        return planText.trim();
    } catch (error) {
        spinner.error(`Planning failed: ${error.message}`);
        // Fall back to a simple plan
        return `1. Explore the project structure\n2. Execute the task: ${task}\n3. Verify the changes`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: EXECUTION LOOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute the autonomous agent loop for a single user request.
 * The AI will iteratively call tools until it has no more tool calls,
 * or the max iteration limit is reached.
 *
 * @param {string} task - The user's task description
 * @param {string} plan - The generated plan
 * @param {Object} tools - Tools map (toolId → tool instance)
 * @param {Object} aiService - The AI provider instance
 * @param {Object} options - { maxIterations }
 * @returns {Promise<string>} The agent's final text response
 */
async function executeAgentLoop(task, plan, tools, aiService, options = {}) {
    const maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;

    const systemPrompt = `${EXECUTION_PROMPT}

The user's task: ${task}

Your plan:
${plan}

Follow this plan. Execute each step using the tools available to you. When done, provide a brief summary.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
    ];

    let iteration = 0;
    let finalResponse = '';

    while (iteration < maxIterations) {
        iteration++;
        displayStep(`Iteration ${iteration}/${maxIterations}`, '🧠', 'magenta', 'Thinking...');

        const spinner = yoctoSpinner({ text: 'AI is thinking...', color: 'magenta' }).start();

        let result;
        try {
            result = await aiService.sendMessage(messages, null, tools, null);
        } catch (error) {
            spinner.error(`AI error: ${error.message}`);
            console.log(chalk.red(`\n❌ AI returned an error: ${error.message}\n`));
            finalResponse = `Error: ${error.message}`;
            break;
        }

        spinner.success(`Iteration ${iteration} complete`);

        const textContent = result.content || '';
        const toolCalls = result.toolCalls || [];

        // Display any text the AI returned
        if (textContent.trim()) {
            console.log('\n');
            console.log(chalk.green.bold('🤖 Agent:'));
            console.log(chalk.gray('─'.repeat(60)));

            // Dynamically import marked from chat-base to reuse terminal rendering
            try {
                const { marked } = await import('../chat/chat-base.js');
                console.log(marked.parse(textContent));
            } catch {
                console.log(textContent);
            }
            console.log(chalk.gray('─'.repeat(60)));
        }

        // If no tool calls, the agent is done
        if (toolCalls.length === 0) {
            displayStep('Done', '✅', 'green', 'Task complete — no more tool calls.');
            finalResponse = textContent;
            break;
        }

        // Push assistant message with tool calls into history
        messages.push({
            role: 'assistant',
            content: textContent || null,
            toolCalls: toolCalls,
        });

        // Execute each tool call
        for (const tc of toolCalls) {
            const toolName = tc.name || tc.toolName;
            const toolInput = tc.input || tc.args || {};

            displayStep('Tool Call', '🔧', 'cyan', toolName);
            displayToolCall({ name: toolName, input: toolInput });

            const toolResult = await executeTool(toolName, toolInput);

            displayStep('Result', '📊', 'green', toolName);
            displayToolResult(toolName, typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult));

            // Push tool result into message history
            messages.push({
                role: 'tool',
                toolCallId: tc.id,
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });
        }
    }

    if (iteration >= maxIterations) {
        console.log(boxen(
            chalk.yellow(`⚠️  Agent reached the maximum iteration limit (${maxIterations}).\n`) +
            chalk.gray('The task may not be fully complete. Review the changes made so far.'),
            {
                padding: 1,
                borderStyle: 'round',
                borderColor: 'yellow',
                title: '⚠️  Iteration Limit',
            }
        ));
        finalResponse = finalResponse || 'Agent stopped: maximum iteration limit reached.';
    }

    return finalResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect project type and run verification commands.
 * @returns {Promise<boolean>} true if verification passed or was skipped
 */
async function verifyChanges() {
    displayStep('Verification', '🔍', 'cyan', 'Checking project health...');

    const verifyCommands = [];

    // Detect project type by checking for config files
    try {
        await fs.access(path.join(process.cwd(), 'package.json'));

        // Node.js project — check for available scripts
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
            // Can't parse package.json, skip
        }
    } catch {
        // No package.json — not a Node project
    }

    // Check for tsconfig.json
    try {
        await fs.access(path.join(process.cwd(), 'tsconfig.json'));
        if (!verifyCommands.some(c => c.includes('tsc'))) {
            verifyCommands.push('npx tsc --noEmit');
        }
    } catch {
        // No tsconfig
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
// PUBLIC API — MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full Wemiy Agent pipeline: plan → execute → verify → summarize.
 *
 * @param {string} task - The task description
 * @param {Object} options - { autoApprove, maxIterations }
 */
export async function runAgent(task, options = {}) {
    const autoApprove = !!options.autoApprove;
    const maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;

    // ── Banner ──────────────────────────────────────────────────────
    console.log(
        boxen(
            chalk.bold.magenta('🤖 Wemiy Agent\n\n') +
            chalk.gray('Autonomous Developer Agent — Plan → Act → Verify → Report'),
            {
                padding: 1,
                borderStyle: 'double',
                borderColor: 'magenta',
            }
        )
    );

    // Show working directory
    console.log(chalk.cyan(`\n📂 Working Directory: ${chalk.bold(process.cwd())}`));
    console.log(chalk.cyan(`🔧 Tools: ${AGENT_TOOL_IDS.join(', ')}`));
    console.log(chalk.cyan(`🔄 Max Iterations: ${maxIterations}`));

    if (autoApprove) {
        console.log(
            boxen(
                chalk.yellow.bold('⚡ AUTO-APPROVE MODE\n\n') +
                chalk.yellow('File edits and command execution will proceed without confirmation.'),
                {
                    padding: 1,
                    borderStyle: 'round',
                    borderColor: 'yellow',
                    title: '⚠️  Warning',
                }
            )
        );
    }

    // ── Initialize AI ───────────────────────────────────────────────
    const aiService = await initAIService();

    // ── Phase 1: Planning ───────────────────────────────────────────
    displayStep('Phase 1', '📋', 'magenta', 'Task Planning');

    const plan = await planTask(task, aiService);
    displayPlan(task, plan);

    // ── Phase 2: Execution ──────────────────────────────────────────
    displayStep('Phase 2', '⚡', 'cyan', 'Execution');

    // Reset change tracker
    changeTracker.reset();

    // Match chat-with-ai-agent.js tool registration/passing pattern.
    // Keep auto-approve behavior by using fs-tools-auto variants when requested.
    let tools;
    if (autoApprove) {
        tools = getAgentTools(true);
    } else {
        enableTools(AGENT_TOOL_IDS);
        tools = getEnabledTools();
    }
    const agentResponse = await executeAgentLoop(task, plan, tools, aiService, { maxIterations });

    // ── Phase 3: Verification ───────────────────────────────────────
    displayStep('Phase 3', '🔍', 'green', 'Verification');

    const report = changeTracker.getReport();
    let verificationPassed = true;

    // Only run verification if files were actually modified
    if (report.filesModified.length > 0 || report.filesCreated.length > 0) {
        verificationPassed = await verifyChanges();

        // If verification failed and we have retries left, let the agent fix
        if (!verificationPassed) {
            console.log(chalk.yellow('\n⚠️  Verification failed. The agent will attempt to fix issues...\n'));

            for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
                displayStep(`Fix Attempt ${retry + 1}/${MAX_VERIFY_RETRIES}`, '🔧', 'yellow');

                const fixResponse = await executeAgentLoop(
                    'The verification step failed. Read the errors above and fix the code so that all checks pass.',
                    'Fix the verification errors',
                    tools,
                    aiService,
                    { maxIterations: 10 }
                );

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

    // ── Phase 4: Summary ────────────────────────────────────────────
    displayStep('Phase 4', '📊', 'cyan', 'Summary');

    // Refresh the report (may have changed during verification retries)
    const finalReport = changeTracker.getReport();
    displaySummary(finalReport, verificationPassed);

    // Display agent's final message
    if (agentResponse && agentResponse.trim()) {
        console.log(
            boxen(
                chalk.white(agentResponse.substring(0, 1000)),
                {
                    padding: 1,
                    borderStyle: 'round',
                    borderColor: 'green',
                    title: '🤖 Agent Response',
                }
            )
        );
    }

    // Clean up tool state for subsequent runs.
    resetTools();

    console.log(chalk.green.bold('\n✨ Agent task complete!\n'));
}
