import chalk from "chalk";
import boxen from "boxen";
import { text, isCancel, cancel, intro, outro, confirm, select } from "@clack/prompts";
import { configManager } from "../config/config-manager.js";
import { slashCommandManager } from "../lib/slash-command-manager.js";
import { undoManager } from "../lib/undo-manager.js";
import { chatService, getUserFromToken, marked } from "./chat-base.js";
import { getAgentTools, AGENT_TOOL_IDS, changeTracker } from "../lib/fs-tools-auto.js";
import {
    AGENT_MODES,
    DISCUSS_TOOL_IDS,
    buildAgentSystemPrompt,
    runAgentLoop,
    appendMessagesFromStoredHistory,
} from "../agent/agent-runtime.js";
import { buildPersistToolCallback } from "../agent/agent-engine.js";
import { loadProjectMemory } from "../lib/agent-project-brief.js";

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 20;
const MAX_HYDRATED_HISTORY = 30;

// ── Provider ───────────────────────────────────────────────────────────────

let aiService = null;

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

async function initConversation(userId, conversationId, mode) {
    const conversation = await chatService.getOrCreateConversation(
        userId,
        conversationId,
        mode === AGENT_MODES.DISCUSS ? 'agent-discuss' : 'agent'
    );

    const toolIds = mode === AGENT_MODES.DISCUSS ? DISCUSS_TOOL_IDS : AGENT_TOOL_IDS;

    const conversationInfo = boxen(
        `${chalk.bold("Conversation")}: ${conversation.title}\n` +
        `${chalk.gray("ID:")} ${conversation.id}\n` +
        `${chalk.gray("Mode:")} ${chalk.magenta(mode === AGENT_MODES.DISCUSS ? "Discuss (Read-only)" : "Act (Autonomous)")}\n` +
        `${chalk.cyan("Working Directory:")} ${process.cwd()}\n` +
        `${chalk.gray("Tools:")} ${toolIds.join(", ")}\n` +
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

// ── Build the message array including prior history ────────────────────────

async function buildMessages(conversation, userPrompt, mode) {
    const memoryMd = await loadProjectMemory();
    const memoryBlock = memoryMd ? `## Project memory (.wemiy/memory.md)\n${memoryMd}` : "";
    const systemPrompt = buildAgentSystemPrompt(mode, memoryBlock);

    const messages = [{ role: "system", content: systemPrompt }];

    try {
        const history = await chatService.getMessages(conversation.id);
        const recent = history.slice(-MAX_HYDRATED_HISTORY);
        appendMessagesFromStoredHistory(messages, recent);
    } catch {
        // best-effort
    }

    messages.push({ role: "user", content: userPrompt });
    return messages;
}

// ── Tool selection per mode ────────────────────────────────────────────────

function buildTools(mode, autoApprove) {
    if (mode === AGENT_MODES.DISCUSS) {
        // Read-only subset, with the auto-approve aware factory so we still
        // get clean change tracking semantics (no edits to track in this mode)
        const all = getAgentTools(autoApprove);
        const subset = {};
        for (const id of DISCUSS_TOOL_IDS) {
            if (all[id]) subset[id] = all[id];
        }
        return subset;
    }
    return getAgentTools(autoApprove);
}

// ── The Outer Agent Session Loop ───────────────────────────────────────────

async function agentLoop(conversation, mode, autoApprove) {
    const helpBox = boxen(
        `${chalk.cyan.bold("What can the agent do?")}\n\n` +
        (mode === AGENT_MODES.DISCUSS ? (
            `${chalk.gray('• Read & explain any part of your codebase')}\n` +
            `${chalk.gray('• Discuss architecture & design choices')}\n` +
            `${chalk.gray('• Help you plan changes (without making them)')}\n` +
            `${chalk.gray('• Answer follow-up questions with project context')}\n\n` +
            `${chalk.yellow.bold("Examples:")}\n` +
            `${chalk.white('• "Walk me through how authentication works"')}\n` +
            `${chalk.white('• "What does the agent loop in agent-engine.js do?"')}\n` +
            `${chalk.white('• "Where is the database connection initialised?"')}\n`
        ) : (
            `${chalk.gray('• Explore your codebase autonomously')}\n` +
            `${chalk.gray('• Find and fix bugs across files')}\n` +
            `${chalk.gray('• Implement features end-to-end')}\n` +
            `${chalk.gray('• Run tests and self-correct on failures')}\n` +
            `${chalk.gray('• Generate complete applications')}\n\n` +
            `${chalk.yellow.bold("Examples:")}\n` +
            `${chalk.white('• "Find and fix the broken import in server.js"')}\n` +
            `${chalk.white('• "Add input validation to all API routes"')}\n` +
            `${chalk.white('• "Run the tests and fix any failures"')}\n`
        )) +
        `\n${chalk.gray('Type "exit" or /exit to end the session')}`,
        {
            padding: 1,
            margin: { bottom: 1 },
            borderStyle: "round",
            borderColor: "cyan",
            title: "💡 Agent Instructions",
        }
    );

    console.log(helpBox);

    const tools = buildTools(mode, autoApprove);
    const renderText = (textContent) => console.log(marked.parse(textContent));

    while (true) {
        const userInput = await text({
            message: chalk.magenta(mode === AGENT_MODES.DISCUSS
                ? "🗣️  Ask anything about the project"
                : "🤖 What would you like to do?"),
            placeholder: mode === AGENT_MODES.DISCUSS
                ? "Ask a question about the codebase..."
                : "Describe a task for the agent...",
            validate(value) {
                if (!value || value.trim().length === 0) {
                    return "Message cannot be empty";
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

        await chatService.addMessage(conversation.id, "user", userInput);

        try {
            // Reset the change tracker per turn so the summary is per-task
            changeTracker.reset();

            const messages = await buildMessages(conversation, userInput, mode);
            const { finalResponse } = await runAgentLoop({
                aiService,
                messages,
                tools,
                maxIterations: MAX_ITERATIONS,
                renderText,
                onPersistToolRound: buildPersistToolCallback(conversation.id),
            });

            await chatService.addMessage(
                conversation.id,
                "assistant",
                finalResponse || "(Agent completed task with tool calls only)"
            );

            // Per-turn summary in act mode
            if (mode === AGENT_MODES.ACT) {
                const report = changeTracker.getReport();
                if (report.filesModified.length || report.filesCreated.length || report.commandsRun.length) {
                    console.log(boxen(
                        `${chalk.green.bold('Files Created:')} ${report.filesCreated.length}\n` +
                        `${chalk.yellow.bold('Files Modified:')} ${report.filesModified.length}\n` +
                        `${chalk.cyan.bold('Commands Run:')} ${report.commandsRun.length}`,
                        { padding: 1, borderStyle: 'round', borderColor: 'cyan', title: '📊 Turn Summary' }
                    ));
                }
            }

            const continuePrompt = await confirm({
                message: chalk.cyan(mode === AGENT_MODES.DISCUSS
                    ? "Ask another question?"
                    : "Would you like to give the agent another task?"),
                initialValue: true,
            });

            if (isCancel(continuePrompt) || !continuePrompt) {
                console.log(chalk.yellow("\n👋 Great! Review the changes the agent made.\n"));
                break;
            }
        } catch (error) {
            console.log(chalk.red(`\n❌ Agent Error: ${error.message}\n`));
            if (process.env.WEMIY_DEBUG && error.stack) {
                console.log(chalk.gray(error.stack));
            }

            await chatService.addMessage(conversation.id, "assistant", `Error: ${error.message}`);

            const retry = await confirm({
                message: chalk.cyan("Would you like to try again?"),
                initialValue: true,
            });

            if (isCancel(retry) || !retry) break;
        }
    }
}

// ── Entry Point ────────────────────────────────────────────────────────────

/**
 * Start the Agent Mode chat session.
 *
 * @param {string|null} conversationId - Optional conversation ID to resume
 * @param {Object} [options]
 * @param {string} [options.mode] - 'act' | 'discuss' (defaults to interactive prompt)
 * @param {boolean} [options.autoApprove] - skip confirmation for edits/commands (act mode)
 */
export async function startAgentChat(conversationId = null, options = {}) {
    try {
        intro(boxen(
            chalk.bold.magenta("🤖 Wemiy AI — Agent Mode\n\n") +
            chalk.gray("Autonomous Developer Agent — Think → Act → Verify → Repeat"),
            { padding: 1, borderStyle: "double", borderColor: "magenta" }
        ));

        const user = await getUserFromToken();
        await initAIService();

        // Pick mode: explicit option > interactive prompt
        let mode = options.mode;
        if (mode !== AGENT_MODES.ACT && mode !== AGENT_MODES.DISCUSS) {
            const choice = await select({
                message: chalk.cyan("How do you want to use the agent?"),
                options: [
                    { value: AGENT_MODES.ACT, label: 'Act',     hint: 'Edit code, run commands, build features' },
                    { value: AGENT_MODES.DISCUSS, label: 'Discuss', hint: 'Read-only — explore & explain the project' },
                ],
            });
            if (isCancel(choice)) {
                cancel(chalk.yellow('Agent mode cancelled'));
                process.exit(0);
            }
            mode = choice;
        }

        const autoApprove = !!options.autoApprove;

        if (mode === AGENT_MODES.ACT) {
            const shouldContinue = await confirm({
                message: chalk.yellow("⚠️  The agent will read/edit files and run commands in the current directory. Continue?"),
                initialValue: true,
            });

            if (isCancel(shouldContinue) || !shouldContinue) {
                cancel(chalk.yellow("Agent mode cancelled"));
                process.exit(0);
            }
        }

        const conversation = await initConversation(user.id, conversationId, mode);
        await agentLoop(conversation, mode, autoApprove);

        outro(chalk.green.bold("\n✨ Thanks for using Agent Mode!"));
    } catch (error) {
        const errorBox = boxen(chalk.red(`❌ Error: ${error.message}`), {
            padding: 1,
            margin: 1,
            borderStyle: "round",
            borderColor: "red",
        });
        console.log(errorBox);
        if (process.env.WEMIY_DEBUG && error.stack) {
            console.log(chalk.gray(error.stack));
        }
        process.exit(1);
    }
}
