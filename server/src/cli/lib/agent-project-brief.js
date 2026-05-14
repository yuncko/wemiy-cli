import { promises as fs } from 'fs';
import path from 'path';

const MARKER_FILES = [
    'tsconfig.json',
    'jsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'build.gradle',
    'Gemfile',
    'composer.json',
];

const MAX_README_LINES = 40;
const MAX_TOP_LEVEL_ENTRIES = 35;

/**
 * Build a compact deterministic project brief for planning and agent context.
 * @param {string} [cwd]
 * @returns {Promise<string>}
 */
export async function collectProjectBrief(cwd = process.cwd()) {
    const lines = [];
    lines.push(`Working directory: ${cwd}`);

    let topEntries = [];
    try {
        const names = await fs.readdir(cwd);
        topEntries = names.slice(0, MAX_TOP_LEVEL_ENTRIES).sort();
        if (names.length > MAX_TOP_LEVEL_ENTRIES) {
            lines.push(`Top-level (first ${MAX_TOP_LEVEL_ENTRIES} of ${names.length}, sorted): ${topEntries.join(', ')}`);
        } else {
            lines.push(`Top-level: ${topEntries.join(', ') || '(empty)'}`);
        }
    } catch (e) {
        lines.push(`(Could not list directory: ${e.message})`);
    }

    const pkgPath = path.join(cwd, 'package.json');
    try {
        const raw = await fs.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(raw);
        const name = pkg.name || '(no name)';
        const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts) : [];
        lines.push(`package.json: name=${name}, scripts=[${scripts.join(', ')}]`);
    } catch {
        lines.push('package.json: not found or invalid');
    }

    const present = [];
    for (const f of MARKER_FILES) {
        try {
            await fs.access(path.join(cwd, f));
            present.push(f);
        } catch {
            /* skip */
        }
    }
    lines.push(`Markers: ${present.length ? present.join(', ') : '(none)'}`);

    for (const readme of ['README.md', 'README.txt', 'Readme.md']) {
        const rp = path.join(cwd, readme);
        try {
            const text = await fs.readFile(rp, 'utf8');
            const preview = text.split('\n').slice(0, MAX_README_LINES).join('\n');
            lines.push(`--- ${readme} (first ${MAX_README_LINES} lines) ---\n${preview}`);
            break;
        } catch {
            /* try next */
        }
    }

    return lines.join('\n');
}

const PROJECT_MEMORY_MAX_CHARS = 8000;

/**
 * Load optional repo-scoped memory for agent system prompts.
 * @param {string} [cwd]
 * @returns {Promise<string>} trimmed markdown or empty string if missing
 */
export async function loadProjectMemory(cwd = process.cwd()) {
    const memoryPath = path.join(cwd, '.wemiy', 'memory.md');
    try {
        const text = await fs.readFile(memoryPath, 'utf8');
        const trimmed = text.trim();
        if (trimmed.length <= PROJECT_MEMORY_MAX_CHARS) return trimmed;
        return `${trimmed.slice(0, PROJECT_MEMORY_MAX_CHARS)}\n\n...(truncated after ${PROJECT_MEMORY_MAX_CHARS} characters)`;
    } catch {
        return '';
    }
}
