import chalk from "chalk";
import { z } from "zod";
import { configManager } from "../config/config-manager.js";
import { GeminiProvider } from "../providers/gemini-provider.js";
import { OpenRouterProvider } from "../providers/openrouter-provider.js";
import { SwiftRouterProvider } from "../providers/swiftrouter-provider.js";
import { readFileContent } from "../utils/file-scanner.js";
import { debug } from "../../lib/debug.js";
import {
    doctorCacheKeyForContent,
    readDoctorCache,
    writeDoctorCache,
} from "../lib/doctor-cache.js";

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

/** Rough prompt budget per batch (characters of file contents + overhead) */
const DEFAULT_MAX_CHARS_PER_BATCH = 52_000;

function normalizeRel(p) {
    return String(p || "")
        .replace(/\\/g, "/")
        .replace(/^\.\/+/, "");
}

function buildCharBatches(items, maxChars) {
    const batches = [];
    let current = [];
    let sum = 0;

    for (const item of items) {
        const len = item.content.length;
        if (current.length > 0 && sum + len > maxChars) {
            batches.push(current);
            current = [];
            sum = 0;
        }
        current.push(item);
        sum += len;
        if (sum >= maxChars) {
            batches.push(current);
            current = [];
            sum = 0;
        }
    }
    if (current.length) batches.push(current);
    return batches;
}

// ── Provider factory (same pattern as fixFile.js) ───────────────────
function getProvider() {
    const config = configManager.getConfig();
    const provider = config.provider || "gemini";

    debug(`[doctor] Using provider: ${provider}`);

    if (provider === "openrouter") {
        return new OpenRouterProvider();
    }
    if (provider === "swiftrouter") {
        return new SwiftRouterProvider();
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
export function parseAIResponse(response) {
    if (typeof response === "object" && response.issues) {
        return response;
    }

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

function cacheIssuesForBatch(batch, allIssuesFromModel, useCache) {
    if (!useCache || !allIssuesFromModel?.length) return;
    for (const fileRow of batch) {
        const norm = normalizeRel(fileRow.relativePath);
        const issuesForFile = allIssuesFromModel.filter(
            (i) => normalizeRel(i.file) === norm
        );
        const key = doctorCacheKeyForContent(fileRow.content);
        writeDoctorCache(key, issuesForFile);
    }
}

/**
 * Analyze files using the AI provider.
 *
 * @param {Array<{absolutePath: string, relativePath: string}>} fileList
 * @param {(completed: number, total: number) => void} [onProgress]
 * @param {{ useCache?: boolean, maxCharsPerBatch?: number }} [options]
 */
export async function analyzeFiles(fileList, onProgress, options = {}) {
    const useCache = !!options.useCache;
    const maxCharsPerBatch = options.maxCharsPerBatch ?? DEFAULT_MAX_CHARS_PER_BATCH;

    const provider = getProvider();
    const allIssues = [];
    let completed = 0;
    const total = fileList.length;

    const bump = () => {
        completed++;
        if (onProgress) onProgress(completed, total);
    };

    /** @type {Array<{absolutePath: string, relativePath: string, content: string}>} */
    const toAnalyze = [];

    for (const file of fileList) {
        const content = await readFileContent(file.absolutePath);
        if (!content?.trim()) {
            bump();
            continue;
        }

        if (useCache) {
            const key = doctorCacheKeyForContent(content);
            const cached = readDoctorCache(key);
            if (cached?.issues && Array.isArray(cached.issues)) {
                allIssues.push(...cached.issues);
                bump();
                continue;
            }
        }

        toAnalyze.push({
            absolutePath: file.absolutePath,
            relativePath: file.relativePath,
            content,
        });
    }

    const batches = buildCharBatches(toAnalyze, maxCharsPerBatch);
    debug(
        `[doctor] ${fileList.length} files → ${toAnalyze.length} need AI → ${batches.length} batches (≤${maxCharsPerBatch} chars/file payload)`
    );

    for (const batch of batches) {
        const filesWithContent = batch.map(({ relativePath, content }) => ({
            relativePath,
            content,
        }));

        const messages = [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(filesWithContent) },
        ];

        try {
            let result;

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

            if (result?.issues) {
                allIssues.push(...result.issues);
                cacheIssuesForBatch(batch, result.issues, useCache);
            }
        } catch (err) {
            debug(`[doctor] Batch analysis error: ${err.message}`);
            console.error(
                chalk.yellow(
                    `\n⚠  Skipping batch (${filesWithContent.map((f) => f.relativePath).join(", ")}): ${err.message}`
                )
            );
        }

        for (let i = 0; i < batch.length; i++) bump();
    }

    return allIssues;
}
