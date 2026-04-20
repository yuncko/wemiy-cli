import { promises as fs } from "fs";
import path from "path";

// ── Supported code extensions ───────────────────────────────────────
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
                if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

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
