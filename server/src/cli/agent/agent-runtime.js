import chalk from 'chalk';
import boxen from 'boxen';
import yoctoSpinner from 'yocto-spinner';
import { availableTools } from '../../config/tool.config.js';
import { AGENT_TOOL_IDS } from '../lib/fs-tools-auto.js';

// ─────────────────────────────────────────────────────────────────────────────
// MODES & TOOL SETS
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_MODES = Object.freeze({
    ACT: 'act',
    DISCUSS: 'discuss',
});

/** Tools allowed in read-only "discuss" mode — no edits, no command execution. */
export const DISCUSS_TOOL_IDS = Object.freeze(['read_files', 'list_dir', 'grep_search']);

export { AGENT_TOOL_IDS };

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function detectShellGuidance() {
    if (process.platform === 'win32') {
        return [
            'You are running on Windows. Use Windows CMD commands only.',
            'Never use: touch, mkdir -p, ls, cat, grep, rm -rf',
            'Instead use: echo. >, mkdir, dir, type, findstr, del',
        ].join('\n');
    }
    if (process.platform === 'darwin') {
        return [
            'You are running on macOS. Use POSIX shell commands.',
            'Use: ls, cat, grep, rm, touch, mkdir -p',
            'Avoid GNU-only flags (e.g. `grep -P`). Prefer `rg` if available, otherwise BSD-style `grep -E`.',
        ].join('\n');
    }
    return [
        'You are running on Linux. Use POSIX/GNU shell commands.',
        'Use: ls, cat, grep, rm, touch, mkdir -p, find, sed, awk',
    ].join('\n');
}

const ACT_PROMPT_BODY = `You are Wemiy Agent, an autonomous AI developer inside a CLI tool.
You have access to tools that let you explore the workspace, read files, edit code, search for patterns, and execute shell commands.

{{SHELL_GUIDANCE}}

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
- replace_content: {"filePath":"src/file.js","targetContent":"old","replacementContent":"new"}`;

const DISCUSS_PROMPT_BODY = `You are Wemiy Agent in DISCUSSION mode — a thoughtful, read-only project guide.
You are talking with a developer about THEIR project. Your job is to understand the code,
explain it accurately, and discuss design or improvement ideas. You CANNOT edit files or
run commands. You only have read-only tools.

{{SHELL_GUIDANCE}}

Available tools (read-only):
- list_dir: explore the directory tree
- read_files: read one or more files in full
- grep_search: search for symbols, patterns, or text across files

How to behave:
- Treat this as a real conversation. Build on what was said earlier in the chat.
- When the user asks "what does X do?", READ the relevant files first, then answer with concrete file/line references.
- When asked architectural questions, use list_dir + read_files + grep_search to ground every claim.
- If you don't have the information yet, say so and use the tools to fetch it before answering.
- If the user asks you to change code, explain that you are in discussion mode and offer to plan the change instead, or suggest switching to "act" mode.
- Be conversational. Use markdown. Cite files like \`src/foo.js\` and reference functions by name.
- Never invent code that isn't in the workspace.

Tool argument format (always pass explicit arguments, never {}):
- list_dir: {"path":"."}
- read_files: {"filePaths":["src/index.js"]}
- grep_search: {"pattern":"sendMessage(", "path":"src"}`;

/**
 * Build the system prompt for the given mode, with OS-specific shell guidance.
 *
 * @param {string} mode - one of AGENT_MODES.ACT | AGENT_MODES.DISCUSS
 * @param {string} [extra] - additional context appended to the prompt (e.g. plan, task)
 * @returns {string}
 */
export function buildAgentSystemPrompt(mode = AGENT_MODES.ACT, extra = '') {
    const shell = detectShellGuidance();
    const body = mode === AGENT_MODES.DISCUSS ? DISCUSS_PROMPT_BODY : ACT_PROMPT_BODY;
    const filled = body.replace('{{SHELL_GUIDANCE}}', shell);
    return extra ? `${filled}\n\n${extra}` : filled;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY HELPERS (shared by every entry point)
// ─────────────────────────────────────────────────────────────────────────────

export function displayStep(label, emoji, color, detail = '') {
    const colorFn = chalk[color] || chalk.white;
    const detailStr = detail ? ` ${chalk.gray('→')} ${chalk.white(detail)}` : '';
    console.log(colorFn(`\n${emoji} [${label}]${detailStr}`));
}

export function displayToolCall(toolCall) {
    const argsStr = JSON.stringify(toolCall.input || toolCall.args || {}, null, 2);
    const truncatedArgs = argsStr.length > 500 ? argsStr.substring(0, 500) + '\n  ...' : argsStr;

    console.log(boxen(
        `${chalk.cyan('Tool:')} ${chalk.bold(toolCall.name)}\n` +
        `${chalk.gray('Args:')} ${truncatedArgs}`,
        {
            padding: 1,
            margin: { left: 2 },
            borderStyle: 'round',
            borderColor: 'cyan',
            title: '🔧 Tool Call',
        }
    ));
}

export function displayToolResult(toolName, result) {
    const truncated = result.length > 800 ? result.substring(0, 800) + '\n...(truncated)' : result;
    console.log(boxen(
        `${chalk.green('Tool:')} ${toolName}\n${chalk.gray('─'.repeat(40))}\n${truncated}`,
        {
            padding: 1,
            margin: { left: 2 },
            borderStyle: 'round',
            borderColor: 'green',
            title: '📊 Result',
        }
    ));
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a tool by ID. Used as a fallback when the provider does not
 * auto-execute tools (OpenAI-compatible providers). Errors are reported
 * to the debug logger with full stack, and a short string is returned to
 * the model so the loop can keep going.
 */
export async function executeTool(toolName, toolInput) {
    const toolConfig = availableTools.find((t) => t.id === toolName);
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
        if (process.env.WEMIY_DEBUG) {
            console.error(chalk.red(`[debug] Tool "${toolName}" threw:`), error);
        }
        return `Error executing tool "${toolName}": ${error.message}`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE AGENT LOOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drive the agent loop until the model stops calling tools or the iteration
 * budget is exhausted. Mutates the `messages` array so callers can inspect
 * the final history.
 *
 * @param {Object} params
 * @param {Object} params.aiService - provider instance with sendMessage(messages, onChunk, tools, onToolCall)
 * @param {Array}  params.messages  - canonical message array (will be appended to)
 * @param {Object} params.tools     - tools map (toolId → AI SDK tool instance)
 * @param {number} [params.maxIterations=25]
 * @param {Function} [params.renderText] - hook to render assistant text content
 * @returns {Promise<{ finalResponse: string, iterationsUsed: number, hitLimit: boolean }>}
 */
export async function runAgentLoop({
    aiService,
    messages,
    tools,
    maxIterations = 25,
    renderText = null,
}) {
    let iteration = 0;
    let finalResponse = '';
    let hitLimit = false;

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
            if (process.env.WEMIY_DEBUG && error.stack) {
                console.log(chalk.gray(error.stack));
            }
            finalResponse = `Error: ${error.message}`;
            break;
        }

        spinner.success(`Iteration ${iteration} complete`);

        const textContent = result.content || '';
        const toolCalls = result.toolCalls || [];

        if (textContent.trim()) {
            console.log('\n');
            console.log(chalk.green.bold('🤖 Agent:'));
            console.log(chalk.gray('─'.repeat(60)));
            if (renderText) {
                renderText(textContent);
            } else {
                console.log(textContent);
            }
            console.log(chalk.gray('─'.repeat(60)));
        }

        if (toolCalls.length === 0) {
            displayStep('Done', '✅', 'green', 'Task complete — no more tool calls.');
            finalResponse = textContent;
            break;
        }

        // Push assistant message with tool calls
        messages.push({
            role: 'assistant',
            content: textContent || null,
            toolCalls,
        });

        // Look up any results the SDK already produced (Gemini auto-executes)
        const sdkResults = new Map();
        for (const tr of (result.toolResults || [])) {
            if (tr && tr.toolCallId) sdkResults.set(tr.toolCallId, tr);
        }

        for (const tc of toolCalls) {
            const toolName = tc.name || tc.toolName;
            const toolInput = tc.input || tc.args || {};
            const callId = tc.id || tc.toolCallId;

            displayStep('Tool Call', '🔧', 'cyan', toolName);
            displayToolCall({ name: toolName, input: toolInput });

            let resultStr;
            const sdkResult = sdkResults.get(callId);
            if (sdkResult) {
                const value = (sdkResult.result !== undefined) ? sdkResult.result : sdkResult.output;
                resultStr = typeof value === 'string' ? value : JSON.stringify(value);
            } else {
                const toolResult = await executeTool(toolName, toolInput);
                resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
            }

            displayStep('Result', '📊', 'green', toolName);
            displayToolResult(toolName, resultStr);

            messages.push({
                role: 'tool',
                toolCallId: callId,
                toolName,
                content: resultStr,
            });
        }
    }

    if (iteration >= maxIterations && !finalResponse) {
        hitLimit = true;
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
        finalResponse = 'Agent stopped: maximum iteration limit reached.';
    }

    return { finalResponse, iterationsUsed: iteration, hitLimit };
}
