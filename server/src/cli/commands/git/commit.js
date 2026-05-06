import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { exec } from "child_process";
import { promisify } from "util";
import { confirm, isCancel, text, select } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { configManager } from "../../config/config-manager.js";
import { GeminiProvider } from "../../providers/gemini-provider.js";
import { OpenRouterProvider } from "../../providers/openrouter-provider.js";
import { SwiftRouterProvider } from "../../providers/swiftrouter-provider.js";
import { debug } from "../../../lib/debug.js";

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

function buildCommitPrompt(diff) {
    return [
        {
            role: "system",
            content: `You are an expert developer who writes excellent, conventional commit messages.
Your task is to analyze the provided git diff and generate a clear, concise, and descriptive commit message.

Rules:
1. Use the conventional commits format: <type>(<optional scope>): <description>
2. The <type> must be one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
3. Keep the first line under 72 characters.
4. If there are multiple changes, you may add an optional longer description body separated by a blank line.
5. Return ONLY the commit message text. No markdown formatting, no explanations, no quotes around the message.`
        },
        {
            role: "user",
            content: `Here is the git diff:\n\n${diff}`
        }
    ];
}

const commitAction = async () => {
    console.log(
        boxen(
            `${chalk.cyan.bold("Wemiy Commit")}\n${chalk.gray(`AI-powered conventional commits`)}`,
            { padding: 1, borderStyle: "round", borderColor: "cyan" }
        )
    );

    // 1. Check if it's a git repo and get staged diff
    let diff = "";
    try {
        const { stdout } = await execAsync("git diff --staged");
        diff = stdout;
    } catch (err) {
        console.error(chalk.red(`\n❌ Failed to run git command. Are you in a git repository?\n`));
        process.exit(1);
    }

    if (!diff.trim()) {
        console.log(chalk.yellow("\n⚠️  No staged changes found. Did you forget to run 'git add'?\n"));
        process.exit(0);
    }

    // 2. Generate commit message
    const spinner = yoctoSpinner({ text: "Analyzing diff and generating commit message..." }).start();
    
    let provider;
    try {
        provider = getProvider();
    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`\n❌ Provider error: ${err.message}\n`));
        process.exit(1);
    }

    const messages = buildCommitPrompt(diff);
    let commitMessage;
    const fenceRegex = /^```[\w]*\n([\s\S]*?)```$/;

    try {
        commitMessage = await provider.getMessage(messages);
        commitMessage = commitMessage.trim();
        // remove any markdown fences if present
        const match = commitMessage.match(fenceRegex);
        if (match) {
            commitMessage = match[1].trim();
        }
    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`\n❌ AI request failed: ${err.message}\n`));
        process.exit(1);
    }

    spinner.stop();

    // 3. Review and Edit
    let finalMessage = commitMessage;
    
    while (true) {
        console.log(`\n${chalk.green("Generated Commit Message:")}\n`);
        console.log(chalk.cyan(finalMessage));
        console.log("");

        const action = await select({
            message: "What would you like to do?",
            options: [
                { value: "accept", label: "Accept and commit" },
                { value: "edit", label: "Edit message" },
                { value: "regenerate", label: "Regenerate message" },
                { value: "cancel", label: "Cancel" }
            ]
        });

        if (isCancel(action) || action === "cancel") {
            console.log(chalk.yellow("\n⚠️  Commit aborted.\n"));
            process.exit(0);
        }

        if (action === "accept") {
            break;
        }

        if (action === "edit") {
            const edited = await text({
                message: "Edit commit message:",
                initialValue: finalMessage
            });
            if (isCancel(edited)) {
                console.log(chalk.yellow("\n⚠️  Commit aborted.\n"));
                process.exit(0);
            }
            finalMessage = edited;
        }

        if (action === "regenerate") {
            spinner.text = "Regenerating commit message...";
            spinner.start();
            try {
                commitMessage = await provider.getMessage(messages);
                finalMessage = commitMessage.trim();
                const match = finalMessage.match(fenceRegex);
                if (match) {
                    finalMessage = match[1].trim();
                }
            } catch (err) {
                spinner.stop();
                console.error(chalk.red(`\n❌ AI request failed: ${err.message}\n`));
                process.exit(1);
            }
            spinner.stop();
        }
    }

    // 4. Commit
    const commitSpinner = yoctoSpinner({ text: "Committing changes..." }).start();
    try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const os = await import("os");
        const tmpFile = path.join(os.tmpdir(), `wemiy_commit_${Date.now()}.txt`);
        
        await fs.writeFile(tmpFile, finalMessage, "utf-8");
        await execAsync(`git commit -F "${tmpFile}"`);
        await fs.unlink(tmpFile).catch(() => {}); // cleanup
        
        commitSpinner.success(chalk.green("Changes committed successfully!"));
    } catch (err) {
        commitSpinner.error("Failed to commit");
        console.error(chalk.red(`\n❌ Git error: ${err.message}\n`));
        if (err.stdout) console.log(err.stdout);
        if (err.stderr) console.error(chalk.yellow(err.stderr));
        process.exit(1);
    }
};

export const commitCommand = new Command("commit")
    .description("Analyze staged changes and automatically generate a conventional commit message")
    .action(commitAction);
