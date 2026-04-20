import chalk from "chalk";
import { z } from "zod";
import { configManager } from "../config/config-manager.js";
import { GeminiProvider } from "../providers/gemini-provider.js";
import { OpenRouterProvider } from "../providers/openrouter-provider.js";
import { readFileContent } from "../utils/file-scanner.js";
import { debug } from "../../lib/debug.js";

// ── Zod schema for a single issue ──────────────────────────────────
export const IssueSchema = z.object({
    file: z.string().describe("Relative path of the file"),
    line: z.number().nullable().describe("Line number, or null if unknown"),
    type: z.enum(["bug", "performance", "security", "bad-practice"]).describe("Issue category"),
    severity: z.enum(["critical", "warning", "info"]).describe("Severity level"),
    message: z.string().describe("Short description of the issue"),
    suggestion: z.string().describe("How to fix the issue"),
});

export const AnalysisResultSchema = z.object({
    issues: z.array(IssueSchema),
});

// ── Constants ───────────────────────────────────────────────────────
const BATCH_SIZE = 5;

// ── Provider factory (same pattern as fixFile.js) ───────────────────
function getProvider() {
    const config = configManager.getConfig();
    const provider = config.provider || "gemini";

    debug(`[doctor] Using provider: ${provider}`);

    if (provider === "openrouter") {
        return new OpenRouterProvider();
    }
    return new GeminiProvider();
}

// ── System prompt ───────────────────────────────────────────────────
function buildSystemPrompt() {
    return `You are an expert code auditor. You will receive source code snippets from a project.
Analyze each file for:
1. **Bugs** — logic errors, uncaught exceptions, race conditions, off-by-one errors, null dereferences, etc.
2. **Performance** — unnecessary re-renders, N+1 queries, blocking I/O, memory leaks, inefficient algorithms.
3. **Security** — injection vulnerabilities (SQL, XSS, command injection), hardcoded secrets, insecure crypto, path traversal, missing auth checks.
4. **Bad practices** — missing error handling, magic numbers, dead code, deprecated APIs, poor naming, missing input validation.

Rules:
- Only report REAL issues. Do NOT invent issues or be overly cautious.
- Be specific: include the line number when possible and quote the problematic code.
- Keep messages concise (1-2 sentences max).
- Return your findings as a JSON object with an "issues" array.
- If a file has no issues, do NOT include it.
- Each issue must have: file, line (number or null), type, severity, message, suggestion.

Valid types: "bug", "performance", "security", "bad-practice"
Valid severities: "critical", "warning", "info"`;
}

function buildUserPrompt(files) {
    let prompt = "Analyze the following files for issues:\n\n";
    for (const { relativePath, content } of files) {
        prompt += `--- FILE: ${relativePath} ---\n${content}\n--- END FILE ---\n\n`;
    }
    prompt += `Return a JSON object: { "issues": [ ... ] }`;
    return prompt;
}

// ── Parse AI response (handles both structured and raw JSON) ────────
function parseAIResponse(response) {
    if (typeof response === "object" && response.issues) {
        return response;
    }

    // Strip markdown fences if present
    let text = typeof response === "string" ? response.trim() : JSON.stringify(response);
    const fenceRegex = /```(?:json)?\n?([\s\S]*?)```/;
    const match = text.match(fenceRegex);
    if (match) {
        text = match[1].trim();
    }

    try {
        const parsed = JSON.parse(text);
        return AnalysisResultSchema.parse(parsed);
    } catch (err) {
        debug(`[doctor] Failed to parse AI response: ${err.message}`);
        debug(`[doctor] Raw response: ${text.substring(0, 500)}`);
        return { issues: [] };
    }
}

/**
 * Analyze a batch of files using the AI provider.
 *
 * @param {Array<{absolutePath: string, relativePath: string}>} fileList
 * @param {Function} onProgress — called with (completed, total)
 * @returns {Promise<Array>} — flat array of issues
 */
export async function analyzeFiles(fileList, onProgress) {
    const provider = getProvider();
    const allIssues = [];
    let completed = 0;

    // Split into batches
    const batches = [];
    for (let i = 0; i < fileList.length; i += BATCH_SIZE) {
        batches.push(fileList.slice(i, i + BATCH_SIZE));
    }

    debug(`[doctor] ${fileList.length} files → ${batches.length} batches of up to ${BATCH_SIZE}`);

    for (const batch of batches) {
        // Read file contents
        const filesWithContent = [];
        for (const file of batch) {
            const content = await readFileContent(file.absolutePath);
            if (content && content.trim()) {
                filesWithContent.push({
                    relativePath: file.relativePath,
                    content,
                });
            }
        }

        if (filesWithContent.length === 0) {
            completed += batch.length;
            if (onProgress) onProgress(completed, fileList.length);
            continue;
        }

        const messages = [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(filesWithContent) },
        ];

        try {
            let result;

            // Try structured output first (Gemini supports it)
            if (provider instanceof GeminiProvider) {
                try {
                    result = await provider.generateStructured(
                        AnalysisResultSchema,
                        `${buildSystemPrompt()}\n\n${buildUserPrompt(filesWithContent)}`
                    );
                } catch {
                    debug("[doctor] Structured generation failed, falling back to getMessage");
                    const raw = await provider.getMessage(messages);
                    result = parseAIResponse(raw);
                }
            } else {
                const raw = await provider.getMessage(messages);
                result = parseAIResponse(raw);
            }

            if (result && result.issues) {
                allIssues.push(...result.issues);
            }
        } catch (err) {
            debug(`[doctor] Batch analysis error: ${err.message}`);
            console.error(
                chalk.yellow(`\n⚠  Skipping batch (${filesWithContent.map(f => f.relativePath).join(", ")}): ${err.message}`)
            );
        }

        completed += batch.length;
        if (onProgress) onProgress(completed, fileList.length);
    }

    return allIssues;
}
