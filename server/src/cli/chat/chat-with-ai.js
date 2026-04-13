import chalk from "chalk";
import boxen from "boxen";
import { text, isCancel, cancel, intro, outro } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { SlashCommandManager } from "../lib/slash-command-manager.js";
import { undoManager } from "../lib/undo-manager.js";

const slashCommandManager = new SlashCommandManager();
import { configManager } from "../config/config-manager.js";
import {
    marked,
    chatService,
    getUserFromToken,
    displayMessages,
    saveMessage,
    updateConversationTitle,
    SYSTEM_PROMPT,
    logUpdate,
} from "./chat-base.js";

let aiService = null;

async function initAIService() {
    try {
        const config = configManager.getConfig();
        const provider = config?.provider || "gemini";
        
        if (provider === 'openrouter') {
            const { OpenRouterProvider } = await import("../providers/openrouter-provider.js");
            aiService = new OpenRouterProvider();
        } else {
            const { GeminiProvider } = await import("../providers/gemini-provider.js");
            aiService = new GeminiProvider();
        }
    } catch (error) {
        console.error(chalk.red(`\nFailed to initialize AI Service: ${error.message}`));
        console.log(chalk.yellow("Falling back to Gemini..."));
        
        // Save fallback to config
        configManager.saveConfig({ provider: "gemini", openrouter: { apiKey: "", model: "" } });
        const { GeminiProvider } = await import("../providers/gemini-provider.js");
        aiService = new GeminiProvider();
    }
}

async function initConversation(userId, conversationId = null, mode = "chat") {
    const spinner = yoctoSpinner({ text: "Loading conversation..." }).start();

    const conversation = await chatService.getOrCreateConversation(
        userId,
        conversationId,
        mode
    );

    spinner.success("Conversation loaded");

    // Display conversation info in a box
    const conversationInfo = boxen(
        `${chalk.bold("Conversation")}: ${conversation.title}\n${chalk.gray("ID: " + conversation.id)}\n${chalk.gray("Mode: " + conversation.mode)}`,
        {
            padding: 1,
            margin: { top: 1, bottom: 1 },
            borderStyle: "round",
            borderColor: "cyan",
            title: "💬 Chat Session",
            titleAlignment: "center",
        }
    );

    console.log(conversationInfo);

    // Display existing messages if any
    if (conversation.messages?.length > 0) {
        console.log(chalk.yellow("📜 Previous messages:\n"));
        displayMessages(conversation.messages);
    }

    return conversation;
}

const MAX_HISTORY = 50;

async function getAIResponse(conversationId) {
    const spinner = yoctoSpinner({
        text: "AI is thinking...",
        color: "cyan"
    }).start();

    const allDbMessages = await chatService.getMessages(conversationId);
    // Truncate to avoid silently hitting the model's token limit on long sessions
    const dbMessages = allDbMessages.slice(-MAX_HISTORY);
    const aiMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...chatService.formatMessagesForAI(dbMessages),
    ];

    let fullResponse = "";
    let isFirstChunk = true;

    try {
        const result = await aiService.sendMessage(aiMessages, (chunk) => {
            if (isFirstChunk) {
                spinner.stop();
                console.log("\n");
                const header = chalk.green.bold("🤖 Assistant:");
                console.log(header);
                console.log(chalk.gray("─".repeat(60)));
                isFirstChunk = false;
            }
            fullResponse += chunk;
            // Render markdown progressively
            logUpdate(marked.parse(fullResponse));
        });

        // Clear log-update and print the final solid block
        logUpdate.clear();
        console.log(marked.parse(fullResponse));
        console.log(chalk.gray("─".repeat(60)));
        console.log("\n");

        return result.content;
    } catch (error) {
        spinner.error("Failed to get AI response");
        throw error;
    }
}

async function chatLoop(conversation) {
    const helpBox = boxen(
        `${chalk.gray('• Type your message and press Enter')}\n${chalk.gray('• Markdown formatting is supported in responses')}\n${chalk.gray('• Type "exit" to end conversation')}\n${chalk.gray('• Press Ctrl+C to quit anytime')}`,
        {
            padding: 1,
            margin: { bottom: 1 },
            borderStyle: "round",
            borderColor: "gray",
            dimBorder: true,
        }
    );

    console.log(helpBox);

    while (true) {
        const userInput = await text({
            message: chalk.blue("💬 Your message"),
            placeholder: "Type your message...",
            validate(value) {
                if (!value || value.trim().length === 0) {
                    return "Message cannot be empty";
                }
            },
        });

        // Handle cancellation (Ctrl+C)
        if (isCancel(userInput)) {
            const exitBox = boxen(chalk.yellow("Chat session ended. Goodbye! 👋"), {
                padding: 1,
                margin: 1,
                borderStyle: "round",
                borderColor: "yellow",
            });
            console.log(exitBox);
            process.exit(0);
        }

        // Handle slash commands (includes /exit)
        if (userInput.startsWith('/')) {
            if (userInput.trim().toLowerCase() === '/model') {
                console.log(chalk.yellow("\n⚠️  Use 'wemiy model' in your terminal instead to switch models.\n"));
                continue;
            }

            const handled = await slashCommandManager.handleSlashCommand(userInput, { 
                undoStack: undoManager,
                onModelChange: async () => { await initAIService(); }
            });
            if (handled) continue;
        }

        // Keep standard exit for pure text match as fallback
        if (userInput.toLowerCase() === "exit") {
            await slashCommandManager.handleSlashCommand("/exit");
            break;
        }

        // Save user message
        await saveMessage(conversation.id, "user", userInput);

        // Get messages count before AI response
        const messages = await chatService.getMessages(conversation.id);

        // Get AI response with streaming and markdown rendering
        const aiResponse = await getAIResponse(conversation.id);

        // Save AI response
        await saveMessage(conversation.id, "assistant", aiResponse);

        // Update title if first message
        await updateConversationTitle(conversation.id, userInput, messages.length);
    }
}

// Main entry point
export async function startChat(mode = "chat", conversationId = null) {
    try {
        // Display intro banner
        intro(
            boxen(chalk.bold.cyan("\n🚀 Wemiys AI Chat"), {
                padding: 1,
                borderStyle: "double",
                borderColor: "cyan",
            })
        );

        const user = await getUserFromToken();
        await initAIService();
        const conversation = await initConversation(user.id, conversationId, mode);
        await chatLoop(conversation);

        // Display outro
        outro(chalk.green("✨ Thanks for chatting!"));
    } catch (error) {
        const errorBox = boxen(chalk.red(`❌ Error: ${error.message}`), {
            padding: 1,
            margin: 1,
            borderStyle: "round",
            borderColor: "red",
        });
        console.log(errorBox);
        process.exit(1);
    }
}