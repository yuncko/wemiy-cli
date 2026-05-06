import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { exec } from "child_process";
import { promisify } from "util";
import yoctoSpinner from "yocto-spinner";
import { configManager } from "../../config/config-manager.js";
import { GeminiProvider } from "../../providers/gemini-provider.js";
import { OpenRouterProvider } from "../../providers/openrouter-provider.js";
import { SwiftRouterProvider } from "../../providers/swiftrouter-provider.js";
import { debug } from "../../../lib/debug.js";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal());

const execAsync = promisify(exec);

function getProvider() {
    const config = configManager.getConfig();
    const provider = config.provider || "gemini";
    debug(`Using provider: ${provider}`);
    if (provider === "openrouter") {
        return new OpenRouterProvider();
    }
    if (provider === "swiftrouter") {
        return new SwiftRouterProvider();
    }
    return new GeminiProvider();
}

function buildReviewPrompt(diff) {
    return [
        {
            role: "system",
            content: `You are an expert code reviewer.
Your task is to analyze the provided git diff and provide constructive feedback.
Look for:
1. Bugs or logic errors
2. Security vulnerabilities
3. Performance issues
4. Bad practices or code smells

If the code looks good, say so explicitly.
Format your response in Markdown, being concise and clear.`
        },
        {
            role: "user",
            content: `Please review this git diff:\n\n${diff}`
        }
    ];
}

const reviewAction = async (options) => {
    console.log(
        boxen(
            `${chalk.cyan.bold("Wemiy Review")}\n${chalk.gray(`AI code review for your changes`)}`,
            { padding: 1, borderStyle: "round", borderColor: "cyan" }
        )
    );

    // 1. Get diff
    let diff = "";
    try {
        const cmd = options.staged ? "git diff --staged" : "git diff HEAD";
        const { stdout } = await execAsync(cmd);
        diff = stdout;
    } catch (err) {
        console.error(chalk.red(`\n❌ Failed to run git command. Are you in a git repository?\n`));
        process.exit(1);
    }

    if (!diff.trim()) {
        console.log(chalk.yellow("\n⚠️  No changes found to review.\n"));
        process.exit(0);
    }

    // 2. Generate review
    const spinner = yoctoSpinner({ text: "Analyzing changes..." }).start();
    
    let provider;
    try {
        provider = getProvider();
    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`\n❌ Provider error: ${err.message}\n`));
        process.exit(1);
    }

    const messages = buildReviewPrompt(diff);
    let reviewMessage;
    
    try {
        reviewMessage = await provider.getMessage(messages);
    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`\n❌ AI request failed: ${err.message}\n`));
        process.exit(1);
    }

    spinner.stop();

    // 3. Output review
    console.log("\n" + marked.parse(reviewMessage) + "\n");
};

export const reviewCommand = new Command("review")
    .description("Analyze current changes and provide an AI code review")
    .option("-s, --staged", "Review only staged changes")
    .action(reviewAction);
