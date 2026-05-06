import chalk from "chalk";
import boxen from "boxen";
import { text, isCancel, cancel, intro, outro, confirm } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { configManager } from "../config/config-manager.js";
import { slashCommandManager } from "../lib/slash-command-manager.js";
import { undoManager } from "../lib/undo-manager.js";
import { chatService, getUserFromToken, logUpdate, marked } from "./chat-base.js";
import {
    availableTools,
    getEnabledTools,
    enableTools,
    resetTools,
} from "../../config/tool.config.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum number of tool-calling iterations before forcing a stop */
const MAX_ITERATIONS = 20;

/** The IDs of tools that the agent auto-enables for autonomous work */
const AGENT_TOOL_IDS = [
    'read_files',
    'edit_file',
    'replace_content',
    'execute_command',
    'list_dir',
    'grep_search',
];

/** System prompt tuned for agentic, autonomous tool use */
const AGENT_SYSTEM_PROMPT = `You are Wemiy Agent, an autonomous AI developer inside a CLI tool.
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
- When your task is complete, provide a brief summary of what you did.`;

// ── Provider ───────────────────────────────────────────────────────────────

let aiService = null;

/**
 * Initialize the AI service based on user configuration.
 */
async function initAIService() {
    try {
        const config = configManager.getConfig();
        const provider = config?.provider || "gemini";
        
        if (provider === 'openrouter') {
            const { OpenRouterProvider } = await import("../providers/openrouter-provider.js");
            aiService = new OpenRouterProvider();
        } else if (provider === 'swiftrouter') {
            const { SwiftRouterProvider } = await import("../providers/swiftrouter-provider.js");
            aiService = new SwiftRouterProvider();
        } else {
            const { GeminiProvider } = await import("../providers/gemini-provider.js");
            aiService = new GeminiProvider();
        }
    } catch (error) {
        console.error(chalk.red(`\nFailed to initialize AI Service: ${error.message}`));
        console.log(chalk.yellow("Falling back to Gemini..."));
        const { GeminiProvider } = await import("../providers/gemini-provider.js");
        aiService = new GeminiProvider();
    }
}

// ── Conversation ───────────────────────────────────────────────────────────

/**
 * Initialize or resume a conversation in agent mode.
 * @param {string} userId
 * @param {string|null} conversationId
 * @returns {Promise<Object>} The conversation object
 */
async function initConversation(userId, conversationId = null) {
    const conversation = await chatService.getOrCreateConversation(
        userId,
        conversationId,
        "agent"
    );

    const toolNames = AGENT_TOOL_IDS.map(id => {
        const t = availableTools.find(at => at.id === id);
        return t ? t.name : id;
    });

    const conversationInfo = boxen(
        `${chalk.bold("Conversation")}: ${conversation.title}\n` +
        `${chalk.gray("ID:")} ${conversation.id}\n` +
        `${chalk.gray("Mode:")} ${chalk.magenta("Agent (Autonomous)")}\n` +
        `${chalk.cyan("Working Directory:")} ${process.cwd()}\n` +
        `${chalk.gray("Tools:")} ${toolNames.join(", ")}\n` +
        `${chalk.gray("Max Iterations:")} ${MAX_ITERATIONS}`,
        {
            padding: 1,
            margin: { top: 1, bottom: 1 },
            borderStyle: "round",
            borderColor: "magenta",
            title: "🤖 Agent Mode",
            titleAlignment: "center",
        }
    );

    console.log(conversationInfo);

    return conversation;
}

// ── Tool Execution ─────────────────────────────────────────────────────────

/**
 * Look up a tool by its ID and execute it with the given input.
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
        // AI SDK tools expose an .execute() method
        if (toolInstance.execute) {
            return await toolInstance.execute(toolInput);
        }
        return `Error: Tool "${toolName}" does not have an execute method.`;
    } catch (error) {
        return `Error executing tool "${toolName}": ${error.message}`;
    }
}

// ── Display Helpers ────────────────────────────────────────────────────────

/**
 * Display a labeled step indicator in the terminal.
 * @param {string} label - Step label (e.g. "Thinking", "Tool Call")
 * @param {string} emoji - Emoji icon
 * @param {string} color - Chalk color name
 * @param {string} detail - Optional detail text
 */
function displayStep(label, emoji, color, detail = '') {
    const colorFn = chalk[color] || chalk.white;
    const detailStr = detail ? ` ${chalk.gray('→')} ${chalk.white(detail)}` : '';
    console.log(colorFn(`\n${emoji} [${label}]${detailStr}`));
}

/**
 * Display tool call information in a formatted box.
 * @param {Object} toolCall - The tool call object { name, input }
 */
function displayToolCall(toolCall) {
    const argsStr = JSON.stringify(toolCall.input || toolCall.args || {}, null, 2);
    const truncatedArgs = argsStr.length > 500 ? argsStr.substring(0, 500) + '\n  ...' : argsStr;

    const toolBox = boxen(
        `${chalk.cyan("Tool:")} ${chalk.bold(toolCall.name)}\n` +
        `${chalk.gray("Args:")} ${truncatedArgs}`,
        {
            padding: 1,
            margin: { left: 2 },
            borderStyle: "round",
            borderColor: "cyan",
            title: "🔧 Tool Call",
        }
    );
    console.log(toolBox);
}

/**
 * Display tool result in a formatted box.
 * @param {string} toolName - Name of the tool
 * @param {string} result - Result string
 */
function displayToolResult(toolName, result) {
    const truncated = result.length > 800 ? result.substring(0, 800) + '\n...(truncated)' : result;
    const resultBox = boxen(
        `${chalk.green("Tool:")} ${toolName}\n${chalk.gray("─".repeat(40))}\n${truncated}`,
        {
            padding: 1,
            margin: { left: 2 },
            borderStyle: "round",
            borderColor: "green",
            title: "📊 Result",
        }
    );
    console.log(resultBox);
}

// ── The Core Agentic Loop ──────────────────────────────────────────────────

/**
 * Execute the autonomous agent loop for a single user request.
 * The AI will iteratively call tools until it has no more tool calls to make,
 * or the max iteration limit is reached.
 *
 * @param {string} userPrompt - The user's task description
 * @param {Object} tools - Enabled tools object (AI SDK format)
 * @returns {Promise<string>} The agent's final text response
 */
async function runAgentLoop(userPrompt, tools) {
    // Build the message history for this task
    const messages = [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
    ];

    let iteration = 0;
    let finalResponse = "";

    while (iteration < MAX_ITERATIONS) {
        iteration++;
        displayStep(`Iteration ${iteration}/${MAX_ITERATIONS}`, "🧠", "magenta", "Thinking...");

        const spinner = yoctoSpinner({ text: "AI is thinking...", color: "magenta" }).start();

        let result;
        try {
            // We use sendMessage WITHOUT a streaming callback so we get the full
            // response and tool calls in one shot. The agent loop controls the flow.
            result = await aiService.sendMessage(messages, null, tools, null);
        } catch (error) {
            spinner.error(`AI error: ${error.message}`);
            console.log(chalk.red(`\n❌ AI returned an error: ${error.message}\n`));
            finalResponse = `Error: ${error.message}`;
            break;
        }

        spinner.success(`Iteration ${iteration} complete`);

        const textContent = result.content || "";
        const toolCalls = result.toolCalls || [];

        // ── If the AI returned text, display it ──
        if (textContent.trim()) {
            console.log('\n');
            console.log(chalk.green.bold("🤖 Agent:"));
            console.log(chalk.gray("─".repeat(60)));
            console.log(marked.parse(textContent));
            console.log(chalk.gray("─".repeat(60)));
        }

        // ── If no tool calls, the agent is done ──
        if (toolCalls.length === 0) {
            displayStep("Done", "✅", "green", "Task complete — no more tool calls.");
            finalResponse = textContent;
            break;
        }

        // ── Push assistant message with tool calls into history ──
        messages.push({
            role: "assistant",
            content: textContent || null,
            toolCalls: toolCalls,
        });

        // ── Execute each tool call ──
        for (const tc of toolCalls) {
            const toolName = tc.name || tc.toolName;
            const toolInput = tc.input || tc.args || {};

            displayStep("Tool Call", "🔧", "cyan", toolName);
            displayToolCall({ name: toolName, input: toolInput });

            const toolResult = await executeTool(toolName, toolInput);

            displayStep("Result", "📊", "green", toolName);
            displayToolResult(toolName, typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult));

            // Push tool result into message history
            messages.push({
                role: "tool",
                toolCallId: tc.id,
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });
        }
    }

    if (iteration >= MAX_ITERATIONS) {
        console.log(boxen(
            chalk.yellow(`⚠️  Agent reached the maximum iteration limit (${MAX_ITERATIONS}).\n`) +
            chalk.gray("The task may not be fully complete. Review the changes made so far."),
            {
                padding: 1,
                borderStyle: "round",
                borderColor: "yellow",
                title: "⚠️  Iteration Limit",
            }
        ));
        finalResponse = finalResponse || "Agent stopped: maximum iteration limit reached.";
    }

    return finalResponse;
}

// ── The Outer Agent Session Loop ───────────────────────────────────────────

/**
 * The outer loop that prompts the user for tasks and runs the agent loop for each.
 * @param {Object} conversation - The conversation object from chatService
 */
async function agentLoop(conversation) {
    const helpBox = boxen(
        `${chalk.cyan.bold("What can the agent do?")}\n\n` +
        `${chalk.gray('• Explore your codebase autonomously')}\n` +
        `${chalk.gray('• Find and fix bugs across files')}\n` +
        `${chalk.gray('• Implement features end-to-end')}\n` +
        `${chalk.gray('• Run tests and self-correct on failures')}\n` +
        `${chalk.gray('• Generate complete applications')}\n\n` +
        `${chalk.yellow.bold("Examples:")}\n` +
        `${chalk.white('• "Find and fix the broken import in server.js"')}\n` +
        `${chalk.white('• "Add input validation to all API routes"')}\n` +
        `${chalk.white('• "Create a REST API with Express and MongoDB"')}\n` +
        `${chalk.white('• "Run the tests and fix any failures"')}\n\n` +
        `${chalk.gray('Type "exit" or /exit to end the session')}`,
        {
            padding: 1,
            margin: { bottom: 1 },
            borderStyle: "round",
            borderColor: "cyan",
            title: "💡 Agent Instructions",
        }
    );

    console.log(helpBox);

    // Auto-enable the agent tools
    enableTools(AGENT_TOOL_IDS);
    const tools = getEnabledTools();

    while (true) {
        const userInput = await text({
            message: chalk.magenta("🤖 What would you like to do?"),
            placeholder: "Describe a task for the agent...",
            validate(value) {
                if (!value || value.trim().length === 0) {
                    return "Task description cannot be empty";
                }
                if (value.trim().length < 5) {
                    return "Please provide more details (at least 5 characters)";
                }
            },
        });

        if (isCancel(userInput)) {
            console.log(chalk.yellow("\n👋 Agent session cancelled\n"));
            process.exit(0);
        }

        // Handle slash commands (includes /exit)
        if (userInput.startsWith('/')) {
            const handled = await slashCommandManager.handleSlashCommand(userInput, { undoStack: undoManager });
            if (handled) continue;
        }

        if (userInput.toLowerCase() === "exit") {
            await slashCommandManager.handleSlashCommand("/exit");
            break;
        }

        const userBox = boxen(chalk.white(userInput), {
            padding: 1,
            margin: { top: 1, bottom: 1 },
            borderStyle: "round",
            borderColor: "blue",
            title: "👤 Your Task",
            titleAlignment: "left",
        });
        console.log(userBox);

        // Save user message to conversation
        await chatService.addMessage(conversation.id, "user", userInput);

        try {
            // Run the autonomous agent loop
            const agentResponse = await runAgentLoop(userInput, tools);

            // Save the final response
            await chatService.addMessage(conversation.id, "assistant", agentResponse || "(Agent completed task with tool calls only)");

            // Ask if user wants to continue
            const continuePrompt = await confirm({
                message: chalk.cyan("Would you like to give the agent another task?"),
                initialValue: true,
            });

            if (isCancel(continuePrompt) || !continuePrompt) {
                console.log(chalk.yellow("\n👋 Great! Review the changes the agent made.\n"));
                break;
            }

        } catch (error) {
            console.log(chalk.red(`\n❌ Agent Error: ${error.message}\n`));

            await chatService.addMessage(conversation.id, "assistant", `Error: ${error.message}`);

            const retry = await confirm({
                message: chalk.cyan("Would you like to try again?"),
                initialValue: true,
            });

            if (isCancel(retry) || !retry) {
                break;
            }
        }
    }
}

// ── Entry Point ────────────────────────────────────────────────────────────

/**
 * Start the Agent Mode chat session.
 * Initializes the AI service, enables agent tools, and enters the agentic loop.
 * @param {string|null} conversationId - Optional conversation ID to resume
 */
export async function startAgentChat(conversationId = null) {
    try {
        intro(
            boxen(
                chalk.bold.magenta("🤖 Wemiy AI — Agent Mode\n\n") +
                chalk.gray("Autonomous Developer Agent — Think → Act → Verify → Repeat"),
                {
                    padding: 1,
                    borderStyle: "double",
                    borderColor: "magenta",
                }
            )
        );

        const user = await getUserFromToken();
        await initAIService();

        // Warning about file system access
        const shouldContinue = await confirm({
            message: chalk.yellow("⚠️  The agent will read/edit files and run commands in the current directory. Continue?"),
            initialValue: true,
        });

        if (isCancel(shouldContinue) || !shouldContinue) {
            cancel(chalk.yellow("Agent mode cancelled"));
            process.exit(0);
        }

        const conversation = await initConversation(user.id, conversationId);
        await agentLoop(conversation);

        // Clean up
        resetTools();

        outro(chalk.green.bold("\n✨ Thanks for using Agent Mode!"));

    } catch (error) {
        const errorBox = boxen(chalk.red(`❌ Error: ${error.message}`), {
            padding: 1,
            margin: 1,
            borderStyle: "round",
            borderColor: "red",
        });
        console.log(errorBox);
        resetTools();
        process.exit(1);
    }
}