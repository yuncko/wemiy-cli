import { promises as fs } from "fs";
import path from "path";
import { CODE_FILE_EXTENSIONS } from "../lib/code-extensions.js";

// ── Directories / files to always skip ──────────────────────────────
const IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "out",
    "coverage",
    ".cache",
    ".vercel",
    ".turbo",
    "__pycache__",
    ".venv",
    "venv",
    "vendor",
    "generated",
]);

const IGNORED_FILES = new Set([
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".DS_Store",
    "thumbs.db",
]);

// Max file size we'll read (100 KB)
const MAX_FILE_SIZE = 100 * 1024;

/**
 * Recursively scan a directory and collect code files.
 *
 * @param {string} rootDir  — absolute path to the directory to scan
 * @returns {Promise<Array<{absolutePath: string, relativePath: string, extension: string, sizeBytes: number}>>}
 */
export async function scanFiles(rootDir) {
    const resolvedRoot = path.resolve(rootDir);
    const results = [];

    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            // Skip directories we can't access
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (IGNORED_DIRS.has(entry.name)) continue;
                await walk(fullPath);
            } else if (entry.isFile()) {
                if (IGNORED_FILES.has(entry.name)) continue;

                const ext = path.extname(entry.name).toLowerCase();
                if (!CODE_FILE_EXTENSIONS.has(ext)) continue;

                // Check file size
                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.size > MAX_FILE_SIZE) continue;
                    if (stat.size === 0) continue;

                    results.push({
                        absolutePath: fullPath,
                        relativePath: path.relative(resolvedRoot, fullPath),
                        extension: ext,
                        sizeBytes: stat.size,
                    });
                } catch {
                    // Skip files we can't stat
                }
            }
        }
    }

    await walk(resolvedRoot);
    return results;
}

/**
 * Build scan entries for explicit repo-relative paths (e.g. git changed files).
 *
 * @param {string} rootDir
 * @param {string[]} relativePaths — paths using "/" as separator preferred
 * @returns {Promise<Array<{absolutePath: string, relativePath: string, extension: string, sizeBytes: number}>>}
 */
export async function resolveScanEntries(rootDir, relativePaths) {
    const resolvedRoot = path.resolve(rootDir);
    const results = [];

    for (let rel of relativePaths) {
        if (!rel || typeof rel !== "string") continue;
        const normRel = rel.replace(/\\/g, "/").replace(/^\.\/+/, "");
        const absolutePath = path.resolve(resolvedRoot, normRel);
        const relToRoot = path.relative(resolvedRoot, absolutePath);
        if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) continue;

        const ext = path.extname(normRel).toLowerCase();
        if (!CODE_FILE_EXTENSIONS.has(ext)) continue;

        try {
            const stat = await fs.stat(absolutePath);
            if (!stat.isFile()) continue;
            if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;

            results.push({
                absolutePath,
                relativePath: normRel,
                extension: ext,
                sizeBytes: stat.size,
            });
        } catch {
            // missing or unreadable
        }
    }

    return results;
}

/**
 * Read file content, returning null if it fails.
 *
 * @param {string} absolutePath
 * @returns {Promise<string|null>}
 */
export async function readFileContent(absolutePath) {
    try {
        return await fs.readFile(absolutePath, "utf-8");
    } catch {
        return null;
    }
}
