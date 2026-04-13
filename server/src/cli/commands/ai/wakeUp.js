import chalk from "chalk";
import { Command } from "commander";
import { select } from "@clack/prompts";
import { startChat } from "../../chat/chat-with-ai.js";
import { startToolChat } from "../../chat/chat-with-ai-tool.js";
import { startAgentChat } from "../../chat/chat-with-ai-agent.js";

const wakeUpAction = async () => {
    console.log(chalk.green(`\nWelcome to Wemiy AI!\n`));

    const choice = await select({
        message: "Select an option:",
        options: [
            {
                value: "chat",
                label: "Chat",
                hint: "Simple chat with AI",
            },
            {
                value: "tool",
                label: "Tool Calling",
                hint: "Chat with tools (Google Search, Code Execution)",
            },
            {
                value: "agent",
                label: "Agentic Mode",
                hint: "Advanced AI agent that can create applications for you",
            },
        ],
    });

    switch (choice) {
        case "chat":
            await startChat("chat");
            break;
        case "tool":
            await startToolChat();
            break;
        case "agent":
            await startAgentChat();
            break;
    }
};

export const wakeUp = new Command("wakeup")
    .description("Wake up the AI")
    .action(wakeUpAction);