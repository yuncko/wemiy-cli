import path from 'path';

const SECRET_LINE_PATTERNS = [
    /\b(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"]?[^\s'"&<>]{8,}/gi,
    /\bbearer\s+[a-z0-9._\-]{20,}\b/gi,
    /\b(password|passwd|pwd)\b\s*[:=]\s*['"]?[^\s'"&<>]{4,}/gi,
    /\b(sk-[a-zA-Z0-9]{20,})\b/g,
    /\b(ghp_[a-zA-Z0-9]{20,})\b/g,
    /\b(xox[baprs]-[a-zA-Z0-9-]{10,})\b/g,
];

/**
 * True if resolved path is under root (no .. escape).
 * @param {string} resolved
 * @param {string} root
 */
export function isPathUnderRoot(resolved, root) {
    const absRoot = path.resolve(root);
    const absTarget = path.resolve(resolved);
    const rel = path.relative(absRoot, absTarget);
    if (rel === '') return true;
    return !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

/**
 * Resolve a user-supplied path against cwd and reject workspace escape.
 * @param {string} userPath
 * @param {string} [cwd]
 * @returns {string} absolute path inside cwd
 */
export function resolveInWorkspace(userPath, cwd = process.cwd()) {
    if (typeof userPath !== 'string' || userPath.trim().length === 0) {
        throw new Error('Path is required.');
    }
    const absCwd = path.resolve(cwd);
    const joined = path.isAbsolute(userPath)
        ? path.resolve(userPath)
        : path.resolve(absCwd, userPath);
    if (!isPathUnderRoot(joined, absCwd)) {
        throw new Error(`Path escapes workspace: ${userPath}`);
    }
    return joined;
}

/**
 * Redact likely secrets from tool output strings.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
    if (typeof text !== 'string' || text.length === 0) return text;
    let out = text;
    for (const re of SECRET_LINE_PATTERNS) {
        out = out.replace(re, '[REDACTED]');
    }
    return out;
}
