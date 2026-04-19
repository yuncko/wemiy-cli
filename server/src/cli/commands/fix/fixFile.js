import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import path from "path";
import { promises as fs } from "fs";
import { confirm, isCancel } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { configManager } from "../../config/config-manager.js";
import { GeminiProvider } from "../../providers/gemini-provider.js";
import { OpenRouterProvider } from "../../providers/openrouter-provider.js";
import { generateDiffPreview } from "../../lib/diff-preview.js";
import { undoManager } from "../../lib/undo-manager.js";
import { debug } from "../../../lib/debug.js";

// Supported file extensions for the fix command
const SUPPORTED_EXTENSIONS = new Set([
    ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt",
    ".c", ".cpp", ".h", ".hpp", ".cs",
    ".json", ".yaml", ".yml", ".toml",
    ".html", ".css", ".scss", ".less",
    ".sql", ".sh", ".bash", ".zsh",
    ".php", ".swift", ".dart", ".lua",
    ".vue", ".svelte",
]);

/**
 * Get the appropriate AI provider based on config
 */
function getProvider() {
    const config = configManager.getConfig();
    const provider = config.provider || "gemini";

    debug(`Using provider: ${provider}`);

    if (provider === "openrouter") {
        return new OpenRouterProvider();
    }
    return new GeminiProvider();
}

/**
 * Build the prompt for the AI to fix bugs in the given code
 */
function buildFixPrompt(filePath, content) {
    const ext = path.extname(filePath);
    const langHints = {
        ".js": "JavaScript", ".ts": "TypeScript", ".jsx": "React JSX",
        ".tsx": "React TSX", ".py": "Python", ".rb": "Ruby",
        ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin",
        ".c": "C", ".cpp": "C++", ".cs": "C#", ".json": "JSON",
        ".html": "HTML", ".css": "CSS", ".sql": "SQL", ".php": "PHP",
        ".swift": "Swift", ".dart": "Dart", ".vue": "Vue", ".svelte": "Svelte",
    };
    const language = langHints[ext] || "code";

    return [
        {
            role: "system",
            content: `You are an expert ${language} developer and code reviewer. Your task is to fix bugs, errors, and issues in the provided code.

Rules:
1. Fix all bugs, syntax errors, logic errors, and potential runtime issues.
2. Preserve the original code style, formatting, and structure as much as possible.
3. Do NOT add new features or refactor unless necessary to fix a bug.
4. Do NOT add comments explaining your changes.
5. Return ONLY the complete fixed file content — no explanations, no markdown fences, no preamble, no trailing text.
6. If the code has no bugs, return it exactly as-is without any modifications.`
        },
        {
            role: "user",
            content: `Fix all bugs in this ${language} file (${path.basename(filePath)}):\n\n${content}`
        }
    ];
}

/**
 * Main fix action
 */
const fixAction = async (file) => {
    const resolvedPath = path.resolve(process.cwd(), file);
    const ext = path.extname(resolvedPath).toLowerCase();

    // ── Validate the file ───────────────────────────────────────────

    // Check extension
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
        console.error(
            chalk.red(`\n❌ Unsupported file type: ${chalk.bold(ext)}\n`) +
            chalk.gray(`   Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`)
        );
        process.exit(1);
    }

    // Check existence
    let content;
    try {
        content = await fs.readFile(resolvedPath, "utf-8");
    } catch (err) {
        if (err.code === "ENOENT") {
            console.error(chalk.red(`\n❌ File not found: ${chalk.bold(resolvedPath)}\n`));
        } else {
            console.error(chalk.red(`\n❌ Failed to read file: ${err.message}\n`));
        }
        process.exit(1);
    }

    // Check empty
    if (!content.trim()) {
        console.error(chalk.red(`\n❌ File is empty: ${chalk.bold(file)}\n`));
        process.exit(1);
    }

    // ── Header ──────────────────────────────────────────────────────

    console.log(
        boxen(
            `${chalk.cyan.bold("🔧 Wemiy Fix")}\n${chalk.gray(`Analyzing: ${path.basename(resolvedPath)}`)}`,
            {
                padding: 1,
                borderStyle: "round",
                borderColor: "cyan",
            }
        )
    );

    // ── Send to AI ──────────────────────────────────────────────────

    let provider;
    try {
        provider = getProvider();
    } catch (err) {
        console.error(chalk.red(`\n❌ Provider error: ${err.message}\n`));
        process.exit(1);
    }

    const messages = buildFixPrompt(resolvedPath, content);
    const spinner = yoctoSpinner({ text: "AI is analyzing and fixing your code..." });
    spinner.start();

    let fixedContent;
    try {
        fixedContent = await provider.getMessage(messages);
    } catch (err) {
        spinner.stop();
        console.error(chalk.red(`\n❌ AI request failed: ${err.message}\n`));
        process.exit(1);
    }

    spinner.stop();

    // ── Clean AI response (strip markdown fences if present) ────────

    fixedContent = cleanAIResponse(fixedContent);

    // ── Compare ─────────────────────────────────────────────────────

    if (fixedContent.trim() === content.trim()) {
        console.log(
            boxen(
                chalk.green("✅ No bugs detected — your code looks good!"),
                {
                    padding: 1,
                    borderStyle: "round",
                    borderColor: "green",
                }
            )
        );
        return;
    }

    // ── Show diff ───────────────────────────────────────────────────

    console.log("\n" + generateDiffPreview(content, fixedContent) + "\n");

    // ── Confirm ─────────────────────────────────────────────────────

    const shouldApply = await confirm({
        message: chalk.cyan(`Apply fixes to ${chalk.bold(path.basename(resolvedPath))}?`),
        initialValue: true,
    });

    if (isCancel(shouldApply) || !shouldApply) {
        console.log(chalk.yellow("\n⚠️  Fix aborted — no changes applied.\n"));
        return;
    }

    // ── Apply ───────────────────────────────────────────────────────

    // Save to undo stack before writing
    undoManager.push(resolvedPath, content);

    await fs.writeFile(resolvedPath, fixedContent, "utf-8");

    console.log(
        boxen(
            `${chalk.green("✅ Fixes applied successfully!")}\n${chalk.gray(`File: ${resolvedPath}`)}`,
            {
                padding: 1,
                borderStyle: "round",
                borderColor: "green",
            }
        )
    );
};

/**
 * Strip markdown code fences and surrounding text from AI response.
 * Some models wrap their output in ```language ... ``` blocks.
 */
function cleanAIResponse(text) {
    if (!text) return text;

    let cleaned = text.trim();

    // Match ```<optional lang>\n ... \n```
    const fenceRegex = /^```[\w]*\n([\s\S]*?)```$/;
    const match = cleaned.match(fenceRegex);
    if (match) {
        cleaned = match[1];
    }

    return cleaned;
}

// ── Export command ───────────────────────────────────────────────────

export const fixCommand = new Command("fix")
    .argument("<file>", "Path to the file to fix")
    .description("Fix bugs and improve code using AI")
    .action(fixAction);
