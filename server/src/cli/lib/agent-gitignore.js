import { promises as fs } from 'fs';
import path from 'path';

/**
 * Load .gitignore from cwd and return a matcher for entry names during tree walk.
 * Conservative: uses basename rules and simple *.ext from root .gitignore only.
 *
 * @param {string} cwd
 * @returns {Promise<(entryName: string, entryRelPath: string, isDirectory: boolean) => boolean>}
 */
export async function loadGitIgnoreMatcher(cwd = process.cwd()) {
    const ignoreNames = new Set();
    const ignoreExts = new Set();
    const gitignorePath = path.join(cwd, '.gitignore');
    try {
        const content = await fs.readFile(gitignorePath, 'utf8');
        for (const line of content.split(/\n/)) {
            const t = line.split('#')[0].trim();
            if (!t || t.startsWith('!')) continue;
            const trimmed = t.replace(/\/+$/, '');
            if (trimmed.includes('/')) {
                const base = path.basename(trimmed);
                if (base && !base.includes('*') && !base.includes('?')) {
                    ignoreNames.add(base);
                }
                continue;
            }
            if (trimmed.startsWith('*.')) {
                ignoreExts.add(trimmed.slice(1).toLowerCase());
                continue;
            }
            if (!trimmed.includes('*') && !trimmed.includes('?')) {
                ignoreNames.add(trimmed);
            }
        }
    } catch {
        /* no .gitignore */
    }

    return (entryName, _entryRelPath, isDirectory) => {
        if (ignoreNames.has(entryName)) return true;
        if (!isDirectory && ignoreExts.size > 0) {
            const ext = path.extname(entryName).toLowerCase();
            if (ext && ignoreExts.has(ext)) return true;
        }
        return false;
    };
}
