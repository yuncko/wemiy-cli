import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { exec } from "child_process";
import { promisify } from "util";
import { confirm, isCancel, text } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import clipboardy from "clipboardy";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { configManager } from "../../config/config-manager.js";
import { GeminiProvider } from "../../providers/gemini-provider.js";
import { OpenRouterProvider } from "../../providers/openrouter-provider.js";
import { SwiftRouterProvider } from "../../providers/swiftrouter-provider.js";
import { debug } from "../../../lib/debug.js";
import { filterPathsToCodeFiles } from "../../lib/code-extensions.js";
import { getRepoChangedRelativePaths } from "../../lib/git-changed-files.js";
import { extractJson, cleanMarkdown } from "../../lib/json-ai-parse.js";

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

const prReadyAction = async (options) => {
    const dryRun = !!options.dryRun;
    
    console.log(
        boxen(
            `${chalk.cyan.bold("🚀 Wemiy PR Ready")}\n${chalk.gray(`Automated pre-PR checks and generation${dryRun ? chalk.yellow(" (DRY RUN)") : ""}`)}`,
            { padding: 1, borderStyle: "round", borderColor: "cyan" }
        )
    );

    let relativeChanged;
    try {
        relativeChanged = await getRepoChangedRelativePaths(process.cwd());
    } catch (err) {
        console.error(chalk.red(`\n❌ ${err.message}\n`));
        process.exit(1);
    }

    const codePaths = filterPathsToCodeFiles(relativeChanged);
    const changedFiles = codePaths.map((rel) => path.join(process.cwd(), rel));

    if (changedFiles.length === 0) {
        console.log(chalk.green("\n✨ Nothing to prepare — no changed code files vs HEAD.\n"));
        process.exit(0);
    }

    let provider;
    try {
        provider = getProvider();
    } catch (err) {
        console.error(chalk.red(`\n❌ Provider error: ${err.message}\n`));
        process.exit(1);
    }

    // STATS for final summary
    let stats = {
        issuesFixed: 0,
        issuesRemaining: 0,
        testsGenerated: 0,
        commitCreated: false,
        prDescriptionReady: false
    };

    // --- STEP 1: Code Review & Auto-Fix ---
    console.log(chalk.cyan("\n[1/4] 🔍 Code Review & Auto-Fix"));
    const fixSpinner = yoctoSpinner({ text: "Analyzing changed files..." }).start();
    
    try {
        for (const file of changedFiles) {
            fixSpinner.text = `Reviewing and fixing ${file}...`;
            
            try {
                // Check if file still exists (might be deleted or not accessible)
                const fileExists = await fs.access(file).then(() => true).catch(() => false);
                if (!fileExists) continue;

                const content = await fs.readFile(file, "utf-8");
                
                const messages = [
                    {
                        role: "system",
                        content: `You are an expert developer. Analyze the code, identify bugs, bad practices, and security issues. 
Auto-fix trivial issues (formatting, unused vars, console.logs).
Return EXACTLY a JSON response wrapped in \`\`\`json block. Format:
{
  "issues": ["issue 1", "issue 2"],
  "fixed": 2,
  "remaining": 1,
  "fixedContent": "full code with fixes applied"
}
If no fixes are needed, set fixed to 0 and fixedContent to the exact original code.`
                    },
                    {
                        role: "user",
                        content: `File: ${file}\n\n${content}`
                    }
                ];

                const response = await provider.getMessage(messages);
                const result = extractJson(response);

                stats.issuesFixed += result.fixed || 0;
                stats.issuesRemaining += result.remaining || 0;

                if (!dryRun && result.fixed > 0 && result.fixedContent && result.fixedContent !== content) {
                    await fs.writeFile(file, result.fixedContent, "utf-8");
                }
            } catch (err) {
                // Ignore individual file errors and continue
                debug(`Failed to process ${file}: ${err.message}`);
            }
        }
        fixSpinner.success(chalk.green(`Code review complete. ${stats.issuesFixed} issues fixed, ${stats.issuesRemaining} remaining.`));
    } catch (err) {
        fixSpinner.error(chalk.yellow("Code review failed or skipped."));
        console.log(chalk.red(`  └─ Error: ${err.message}`));
    }

    // --- STEP 2: Test Coverage Check ---
    console.log(chalk.cyan("\n[2/4] 🧪 Test Coverage Check"));
    const testSpinner = yoctoSpinner({ text: "Checking test coverage..." }).start();
    
    try {
        let pkgJson = "{}";
        try {
            pkgJson = await fs.readFile("package.json", "utf-8");
        } catch(e) {}

        for (const file of changedFiles) {
            try {
                // Double check it's not already a test file
                if (file.match(/\.(test|spec)\./i) || file.includes('__tests__')) {
                    continue;
                }

                const ext = path.extname(file);
                const basename = path.basename(file, ext);
                const dir = path.dirname(file);
                
                // Check if test exists
                const testNames = [
                    path.join(dir, `${basename}.test${ext}`),
                    path.join(dir, `${basename}.spec${ext}`),
                    path.join(dir, "__tests__", `${basename}.test${ext}`)
                ];

                let testExists = false;
                for (const t of testNames) {
                    if (await fs.access(t).then(() => true).catch(() => false)) {
                        testExists = true;
                        break;
                    }
                }

                if (!testExists) {
                    testSpinner.text = `Generating test for ${file}...`;
                    const content = await fs.readFile(file, "utf-8");
                    
                    const messages = [
                        {
                            role: "system",
                            content: `You are an expert QA engineer. Generate a basic test file for the provided code.
Use the test framework present in the project (look at package.json if needed, typically Jest, Mocha, or node test runner).
Return ONLY the raw test code, no markdown formatting, no explanations.`
                        },
                        {
                            role: "user",
                            content: `package.json: ${pkgJson}\n\nFile to test: ${file}\n\nCode:\n${content}`
                        }
                    ];

                    const testCodeRaw = await provider.getMessage(messages);
                    const testCode = cleanMarkdown(testCodeRaw);
                    
                    const testPath = path.join(dir, `${basename}.test${ext}`);
                    if (!dryRun) {
                        await fs.writeFile(testPath, testCode, "utf-8");
                    }
                    stats.testsGenerated++;
                    console.log(chalk.gray(`\n  Generated test: ${testPath}`));
                }
            } catch (err) {
                debug(`Failed to check/generate test for ${file}: ${err.message}`);
            }
        }
        testSpinner.success(chalk.green(`Test coverage check complete. ${stats.testsGenerated} files generated.`));
    } catch (err) {
        testSpinner.error(chalk.yellow("Test coverage check failed."));
        console.log(chalk.red(`  └─ Error: ${err.message}`));
    }

    // --- STEP 3: Commit Message Generator ---
    console.log(chalk.cyan("\n[3/4] 📝 Commit Message Generator"));
    
    let commitSuccess = false;
    try {
        if (!dryRun) {
            await execAsync("git add -A");
        }
        
        // If it's a dry run, git add hasn't happened, so diff --staged might be empty.
        // For dry run, we use regular diff or staged diff if it exists.
        let diffCmd = "git diff --staged";
        if (dryRun) {
             diffCmd = "git diff HEAD";
        }
        const { stdout: diff } = await execAsync(diffCmd);
        
        if (!diff.trim()) {
            console.log(chalk.yellow("  No changes to commit."));
        } else {
            const commitSpinner = yoctoSpinner({ text: "Generating commit message..." }).start();
            
            const messages = [
                {
                    role: "system",
                    content: `Generate a conventional commit message for the following diff.
Format: type(scope): description
Types: feat, fix, refactor, test, docs, chore.
Return ONLY the commit message text. No markdown, no quotes.`
                },
                {
                    role: "user",
                    content: `Diff:\n${diff}`
                }
            ];

            let commitMessage = await provider.getMessage(messages);
            commitMessage = cleanMarkdown(commitMessage);
            commitSpinner.success("Commit message generated.");

            console.log(`\n${chalk.green("Generated Message:")}\n${chalk.white(commitMessage)}\n`);

            let finalMessage = commitMessage;
            
            const useMessage = await confirm({
                message: "Use this commit message?",
                initialValue: true
            });

            if (isCancel(useMessage)) {
                 console.log(chalk.yellow("  Commit skipped."));
            } else if (!useMessage) {
                const customMessage = await text({
                    message: "Enter your commit message:"
                });
                if (!isCancel(customMessage) && customMessage.trim()) {
                    finalMessage = customMessage;
                } else {
                    console.log(chalk.yellow("  Commit skipped."));
                    finalMessage = null;
                }
            }

            if (finalMessage) {
                if (dryRun) {
                    console.log(chalk.yellow("  [DRY RUN] Would commit with message: " + finalMessage));
                    stats.commitCreated = true;
                    commitSuccess = true;
                } else {
                    const tmpFile = path.join(os.tmpdir(), `wemiy_pr_commit_${Date.now()}.txt`);
                    await fs.writeFile(tmpFile, finalMessage, "utf-8");
                    await execAsync(`git commit -F "${tmpFile}"`);
                    await fs.unlink(tmpFile).catch(() => {});
                    console.log(chalk.green("  ✔ Changes committed."));
                    stats.commitCreated = true;
                    commitSuccess = true;
                }
            }
        }
    } catch (err) {
        console.error(chalk.yellow(`  Failed to create commit: ${err.message}`));
    }

    // --- STEP 4: PR Description Generator ---
    console.log(chalk.cyan("\n[4/4] 📋 PR Description Generator"));
    const prSpinner = yoctoSpinner({ text: "Generating PR description..." }).start();
    
    try {
        let log = "";
        try {
            const { stdout } = await execAsync("git log origin/main..HEAD --oneline");
            log = stdout;
        } catch {
            try {
                const { stdout } = await execAsync("git log origin/master..HEAD --oneline");
                log = stdout;
            } catch {
                try {
                    const { stdout } = await execAsync("git log HEAD~3..HEAD --oneline");
                    log = stdout;
                } catch {
                    log = "Could not fetch git log.";
                }
            }
        }

        // diff
        let prDiff = "";
        try {
             if (commitSuccess && !dryRun) {
                 const { stdout } = await execAsync("git diff HEAD~1 HEAD");
                 prDiff = stdout;
             } else {
                 const { stdout } = await execAsync("git diff HEAD");
                 prDiff = stdout;
             }
        } catch (e) {
             prDiff = "Could not fetch diff.";
        }

        const messages = [
            {
                role: "system",
                content: `Generate a PR description based on the diff and commit history.
Use EXACTLY this markdown format:

## What changed
[bullet points of changes]

## Why
[explanation of motivation]

## How to test
[step by step testing instructions]

## Checklist
- [ ] Code reviewed
- [ ] Tests added
- [ ] No console.logs left
- [ ] Environment variables documented

Return ONLY the markdown text.`
            },
            {
                role: "user",
                content: `Commits:\n${log}\n\nDiff:\n${prDiff}`
            }
        ];

        let prDescRaw = await provider.getMessage(messages);
        const prDesc = cleanMarkdown(prDescRaw);
        prSpinner.success("PR description generated.");
        
        if (dryRun) {
            console.log(chalk.yellow("\n  [DRY RUN] Would copy to clipboard and save to pr-description.md"));
            console.log(chalk.gray("\n" + prDesc + "\n"));
            stats.prDescriptionReady = true;
        } else {
            await clipboardy.write(prDesc);
            await fs.writeFile(path.join(process.cwd(), "pr-description.md"), prDesc, "utf-8");
            console.log(chalk.green("  ✔ PR description copied to clipboard and saved to pr-description.md"));
            stats.prDescriptionReady = true;
        }

    } catch (err) {
        prSpinner.error(chalk.yellow("PR description generation failed."));
        console.log(chalk.red(`  └─ Error: ${err.message}`));
    }

    // --- STEP 5: Final Summary ---
    console.log("");
    console.log(
        boxen(
            `${chalk.bold("         PR READY SUMMARY             ")}\n` +
            `──────────────────────────────────────\n` +
            `${chalk.green(stats.issuesFixed > 0 ? "✔" : "➖")} Issues fixed:        ${stats.issuesFixed}\n` +
            `${stats.issuesRemaining > 0 ? chalk.yellow("⚠") : chalk.green("✔")} Issues remaining:    ${stats.issuesRemaining}\n` +
            `${chalk.green(stats.testsGenerated > 0 ? "✔" : "➖")} Tests generated:     ${stats.testsGenerated} files\n` +
            `${stats.commitCreated ? chalk.green("✔") : chalk.yellow("➖")} Commit created:      ${stats.commitCreated ? "yes" : "no"}\n` +
            `${stats.prDescriptionReady ? chalk.green("✔") : chalk.yellow("➖")} PR description:      ${stats.prDescriptionReady ? "ready" : "failed"}`,
            { padding: 1, borderStyle: "double", borderColor: "cyan" }
        )
    );
    console.log("");
};

export const prReadyCommand = new Command("pr-ready")
    .description("Automate pre-PR checks, fixes, test generation, and commit")
    .option("--dry-run", "Run all steps without making any changes to files, git, or clipboard")
    .action(prReadyAction);
