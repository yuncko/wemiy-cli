import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * List paths changed vs HEAD: staged + unstaged + untracked (excluding ignored).
 * Returns posix-style relative segments as reported by git.
 *
 * @param {string} cwd - Repository root
 * @returns {Promise<string[]>}
 */
export async function getRepoChangedRelativePaths(cwd = process.cwd()) {
    const opts = { cwd, maxBuffer: 50 * 1024 * 1024 };
    const names = new Set();

    const ingest = (stdout) => {
        for (const line of stdout.split("\n")) {
            const t = line.trim();
            if (t) names.add(t.replace(/\\/g, "/"));
        }
    };

    try {
        const { stdout: unstagedStaged } = await execAsync(
            "git diff --name-only HEAD",
            opts
        );
        ingest(unstagedStaged);
    } catch {
        throw new Error("Not a git repository or git failed — run from a repo root");
    }

    try {
        const { stdout: untracked } = await execAsync(
            "git ls-files --others --exclude-standard",
            opts
        );
        ingest(untracked);
    } catch {
        // Untracked listing failure — keep diff-only set
    }

    return [...names];
}
