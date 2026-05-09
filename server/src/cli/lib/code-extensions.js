import path from "path";

/** Extensions scanned by doctor / filesystem walker — single source of truth */
export const CODE_FILE_EXTENSIONS = new Set([
    ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt",
    ".c", ".cpp", ".h", ".hpp", ".cs",
    ".json", ".yaml", ".yml", ".toml",
    ".html", ".css", ".scss", ".less",
    ".sql", ".sh", ".bash", ".zsh",
    ".php", ".swift", ".dart", ".lua",
    ".vue", ".svelte",
]);

export function pathHasCodeExtension(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return CODE_FILE_EXTENSIONS.has(ext);
}

/** Normalize repo-relative paths and keep only supported code files */
export function filterPathsToCodeFiles(paths) {
    const out = [];
    const seen = new Set();
    for (let p of paths) {
        if (!p || typeof p !== "string") continue;
        const norm = p.replace(/\\/g, "/").trim();
        if (!norm || seen.has(norm)) continue;
        if (!pathHasCodeExtension(norm)) continue;
        seen.add(norm);
        out.push(norm);
    }
    return out;
}
