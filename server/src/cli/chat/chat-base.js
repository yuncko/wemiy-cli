import chalk from "chalk";
import boxen from "boxen";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import logUpdate from "log-update";


// Configure marked to use terminal renderer (once, shared across all chat modes)
marked.use(
    markedTerminal({
        // use default styles but remove aggressive colors for normal text
        paragraph: chalk.reset,
    })
);

// Override the code block renderer to use boxen
marked.use({
    renderer: {
        code(token) {
            const text = typeof token === 'string' ? token : (token?.text || '');
            const lang = typeof token === 'string' ? arguments[1] : (token?.lang || '');
            return boxen(text, {
                title: lang ? ` ${lang} ` : undefined,
                padding: 1,
                borderStyle: 'round',
                borderColor: 'cyan'
            }) + '\n\n';
        }
    }
});

import { ChatService } from "../../services/chat.service.js";
export { marked, logUpdate };
export const chatService = new ChatService();

export async function getUserFromToken() {
    return {
        id: "local-user",
        name: "Local User",
    };
}

/**
 * Display a list of messages in formatted boxes
 * @param {Array} messages - Array of message objects with role and content
 */
export function displayMessages(messages) {
    messages.forEach((msg) => {
        if (msg.role === "user") {
            const userBox = boxen(chalk.white(msg.content), {
                padding: 1,
                margin: { left: 2, bottom: 1 },
                borderStyle: "round",
                borderColor: "blue",
                title: "👤 You",
                titleAlignment: "left",
            });
            console.log(userBox);
        } else if (msg.role === "assistant") {
            const renderedContent = marked.parse(msg.content);
            const assistantBox = boxen(renderedContent.trim(), {
                padding: 1,
                margin: { left: 2, bottom: 1 },
                borderStyle: "round",
                borderColor: "green",
                title: "🤖 Assistant",
                titleAlignment: "left",
            });
            console.log(assistantBox);
        }
    });
}

/**
 * Save a message to the database
 * @param {string} conversationId - Conversation ID
 * @param {string} role - Message role (user, assistant, system, tool)
 * @param {string|object} content - Message content
 */
export async function saveMessage(conversationId, role, content) {
    return await chatService.addMessage(conversationId, role, content);
}

/**
 * Update conversation title based on the first user message
 * @param {string} conversationId - Conversation ID
 * @param {string} userInput - The user's message
 * @param {number} messageCount - Current number of messages in conversation
 */
export async function updateConversationTitle(conversationId, userInput, messageCount) {
    if (messageCount === 1) {
        const title = userInput.slice(0, 50) + (userInput.length > 50 ? "..." : "");
        await chatService.updateTitle(conversationId, title);
    }
}

/**
 * System prompt for Wemiys AI
 */
export const SYSTEM_PROMPT = `You are Wemiys AI, a helpful coding assistant built into a developer CLI tool.

You help developers write, debug, and understand code. You are practical, concise, and technically accurate.

Guidelines:
- Format code blocks with language identifiers (e.g. \`\`\`javascript)
- Be concise — avoid unnecessary preambles
- When showing code changes, explain what changed and why
- If you're unsure, say so rather than guessing
- Prefer modern JavaScript/TypeScript best practices`;
