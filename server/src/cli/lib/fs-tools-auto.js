import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { confirm } from '@clack/prompts';
import { generateDiffPreview } from './diff-preview.js';
import { undoManager } from './undo-manager.js';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function getBaseDir(baseDir) {
    return (typeof baseDir === 'string' && baseDir.trim().length > 0) ? baseDir : process.cwd();
}

function safeResolve(baseDir, ...parts) {
    const base = getBaseDir(baseDir);
    const filtered = parts.filter(p => typeof p === 'string' && p.length > 0);
    if (filtered.length === 0) {
        throw new Error('Path is required.');
    }
    return path.resolve(base, ...filtered);
}

function isWindows() {
    return process.platform === 'win32';
}

function translateCommandForWindows(command) {
    if (!isWindows()) return command;
    if (typeof command !== 'string') return command;

    const trimmed = command.trim();
    if (trimmed === 'ls') return 'dir';

    // touch <file>  -> type nul > <file>
    const touchMatch = trimmed.match(/^touch\s+(.+)$/);
    if (touchMatch) {
        const file = touchMatch[1].trim();
        return `type nul > ${file}`;
    }

    // mkdir -p <dir> -> mkdir <dir>
    const mkdirPMatch = trimmed.match(/^mkdir\s+-p\s+(.+)$/);
    if (mkdirPMatch) {
        const dir = mkdirPMatch[1].trim();
        return `mkdir ${dir}`;
    }

    return command;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE TRACKER
// Tracks files modified, files created, and commands executed during an agent
// session so we can generate a summary report at the end.
// ─────────────────────────────────────────────────────────────────────────────

class ChangeTracker {
    constructor() {
        this.filesModified = new Set();
        this.filesCreated = new Set();
        this.commandsRun = [];
    }

    trackFileModified(filePath) {
        if (typeof filePath !== 'string' || filePath.trim().length === 0) return;
        this.filesModified.add(safeResolve(undefined, filePath));
    }

    trackFileCreated(filePath) {
        if (typeof filePath !== 'string' || filePath.trim().length === 0) return;
        this.filesCreated.add(safeResolve(undefined, filePath));
    }

    trackCommand(command, success) {
        this.commandsRun.push({ command, success, timestamp: Date.now() });
    }

    getReport() {
        return {
            filesModified: [...this.filesModified],
            filesCreated: [...this.filesCreated],
            commandsRun: this.commandsRun,
        };
    }

    reset() {
        this.filesModified.clear();
        this.filesCreated.clear();
        this.commandsRun = [];
    }
}

export const changeTracker = new ChangeTracker();

// ─────────────────────────────────────────────────────────────────────────────
// IGNORE LISTS (shared with fs-tools.js)
// ─────────────────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.cache', '__pycache__', '.turbo']);
const IGNORE_FILES = new Set(['.env', '.env.local', '.env.production']);
const IGNORE_EXTENSIONS = new Set(['.lock']);

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: conditionally confirm or auto-approve
// ─────────────────────────────────────────────────────────────────────────────

async function shouldProceed(message, autoApprove) {
    if (autoApprove) {
        console.log(chalk.gray(`  ⚡ Auto-approved: ${message}`));
        return true;
    }
    const result = await confirm({ message, initialValue: true });
    return !!result;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL FACTORIES
// Each factory returns an AI SDK tool() instance. The autoApprove flag
// controls whether user confirmation is skipped.
// ─────────────────────────────────────────────────────────────────────────────

function makeReadFileTool() {
    return tool({
        description: 'Read contents of one or multiple local files.',
        parameters: z.object({
            filePaths: z.array(z.string()).optional().describe('List of absolute or relative file paths to read. Example: ["src/index.js", "package.json"]'),
            paths: z.array(z.string()).optional().describe('Alias of filePaths (some models send "paths").'),
            files: z.array(z.string()).optional().describe('Alias of filePaths (some models send "files").'),
        }),
        execute: async (params) => {
            const files = params?.filePaths ?? params?.paths ?? params?.files ?? [];
            if (!Array.isArray(files)) {
                return 'Error: read_files expects "filePaths" (or alias "paths"/"files") to be an array of strings.';
            }
            const results = [];
            for (const fp of files) {
                try {
                    if (typeof fp !== 'string' || fp.trim().length === 0) {
                        results.push(`--- Error reading (empty path) ---: file path must be a non-empty string`);
                        continue;
                    }
                    const resolvedPath = safeResolve(undefined, fp);
                    const content = await fs.readFile(resolvedPath, 'utf8');
                    results.push(`--- File: ${fp} ---\n${content}`);
                } catch (err) {
                    results.push(`--- Error reading ${fp} ---: ${err.message}`);
                }
            }
            return results.join('\n\n');
        },
    });
}

function makeEditFileTool(autoApprove) {
    return tool({
        description: 'Edit a file by completely replacing its content. Use replace_content instead for targeted edits.',
        parameters: z.object({
            filePath: z.string().describe('Path to the file to edit'),
            newContent: z.string().describe('The complete new content of the file.'),
        }),
        execute: async ({ filePath, newContent }) => {
            try {
                if (typeof filePath !== 'string' || filePath.trim().length === 0) {
                    return 'Failed to edit file: filePath must be a non-empty string.';
                }
                const resolvedPath = safeResolve(undefined, filePath);
                let oldContent = '';

                try {
                    oldContent = await fs.readFile(resolvedPath, 'utf8');
                } catch {
                    console.log(chalk.gray(`\nFile ${filePath} not found. Will be created.`));
                    changeTracker.trackFileCreated(filePath);
                }

                // Show diff
                console.log('\n');
                console.log(generateDiffPreview(oldContent, newContent));

                const approved = await shouldProceed(
                    chalk.cyan(`Apply these changes to ${filePath}?`),
                    autoApprove
                );

                if (!approved) {
                    console.log(chalk.yellow(`\n⚠️  Changes to ${filePath} aborted by user.\n`));
                    return `User rejected the file edit for ${filePath}.`;
                }

                undoManager.push(resolvedPath, oldContent);
                await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
                await fs.writeFile(resolvedPath, newContent, 'utf8');

                changeTracker.trackFileModified(filePath);
                console.log(chalk.green(`\n✅ Saved changes to ${filePath}\n`));
                return `Successfully updated ${filePath}.`;
            } catch (error) {
                return `Failed to edit file ${filePath}. Error: ${error.message}`;
            }
        },
    });
}

function makeReplaceContentTool(autoApprove) {
    return tool({
        description: 'Replace a specific block of text inside a file. Preferred way to edit files.',
        parameters: z.object({
            filePath: z.string().describe('Path to the file to edit (relative or absolute)'),
            targetContent: z.string().describe('The exact block of text to find in the file.'),
            replacementContent: z.string().describe('The new block of text to replace the target with.'),
        }),
        execute: async ({ filePath, targetContent, replacementContent }) => {
            try {
                if (typeof filePath !== 'string' || filePath.trim().length === 0) {
                    return 'Error: filePath must be a non-empty string.';
                }
                const resolvedPath = safeResolve(undefined, filePath);
                let fileContent;

                try {
                    fileContent = await fs.readFile(resolvedPath, 'utf8');
                } catch {
                    return `Error: File "${filePath}" not found.`;
                }

                const index = fileContent.indexOf(targetContent);
                if (index === -1) {
                    return `Error: Could not find the target content in "${filePath}". Read the file first to get the exact content.`;
                }

                const secondIndex = fileContent.indexOf(targetContent, index + 1);
                if (secondIndex !== -1) {
                    return `Warning: Found multiple occurrences of the target content in "${filePath}". Provide a more unique block.`;
                }

                const newContent = fileContent.substring(0, index) + replacementContent + fileContent.substring(index + targetContent.length);

                console.log('\n');
                console.log(generateDiffPreview(fileContent, newContent));

                const approved = await shouldProceed(
                    chalk.cyan(`Apply this replacement to ${filePath}?`),
                    autoApprove
                );

                if (!approved) {
                    console.log(chalk.yellow(`\n⚠️  Replacement in ${filePath} aborted by user.\n`));
                    return `User rejected the replacement in ${filePath}.`;
                }

                undoManager.push(resolvedPath, fileContent);
                await fs.writeFile(resolvedPath, newContent, 'utf8');

                changeTracker.trackFileModified(filePath);
                console.log(chalk.green(`\n✅ Replaced content in ${filePath}\n`));
                return `Successfully replaced content in ${filePath}.`;
            } catch (error) {
                return `Failed to replace content in ${filePath}. Error: ${error.message}`;
            }
        },
    });
}

function makeExecuteCommandTool(autoApprove) {
    return tool({
        description: 'Run a shell command in the current workspace.',
        parameters: z.object({
            command: z.string().describe('The shell command to execute, e.g. "npm test" or "npx tsc"'),
        }),
        execute: async ({ command }) => {
            try {
                const translated = translateCommandForWindows(command);
                console.log('\n');
                console.log(chalk.cyan(`🤖 AI wants to run command: ${chalk.bold(translated)}`));

                const approved = await shouldProceed(
                    chalk.cyan('Allow execution of this command?'),
                    autoApprove
                );

                if (!approved) {
                    console.log(chalk.yellow('\n⚠️  Command execution aborted by user.\n'));
                    changeTracker.trackCommand(translated, false);
                    return `User rejected the execution of command: ${translated}.`;
                }

                console.log(chalk.gray(`\nRunning: ${translated}\n`));

                const { stdout, stderr } = await execAsync(translated, {
                    cwd: process.cwd(),
                    timeout: 120000, // 120s timeout — agent tasks may run longer
                    shell: isWindows() ? 'cmd.exe' : undefined,
                });

                let result = '';
                if (stdout) {
                    console.log(stdout);
                    result += `Stdout:\n${stdout}\n`;
                }
                if (stderr) {
                    console.error(chalk.yellow(stderr));
                    result += `Stderr:\n${stderr}\n`;
                }

                if (!result) {
                    result = 'Command executed successfully with no output.';
                }

                changeTracker.trackCommand(translated, true);
                console.log(chalk.green('\n✅ Command completed\n'));
                return result;
            } catch (error) {
                changeTracker.trackCommand(typeof command === 'string' ? command : String(command), false);
                console.error(chalk.red(`\n❌ Command failed: ${error.message}\n`));
                if (error.stdout) console.log(error.stdout);
                if (error.stderr) console.error(chalk.yellow(error.stderr));

                return `Command failed with error: ${error.message}\nStdout: ${error.stdout || ''}\nStderr: ${error.stderr || ''}`;
            }
        },
    });
}

function makeListDirTool() {
    async function buildTree(dir, prefix = '', depth = 0, maxDepth = 3) {
        if (depth >= maxDepth) return '';

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return `${prefix}[permission denied]\n`;
        }

        entries = entries.filter(entry => {
            if (IGNORE_DIRS.has(entry.name) && entry.isDirectory()) return false;
            if (IGNORE_FILES.has(entry.name)) return false;
            if (IGNORE_EXTENSIONS.has(path.extname(entry.name))) return false;
            return true;
        });

        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        let tree = '';
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? '    ' : '│   ';

            if (entry.isDirectory()) {
                tree += `${prefix}${connector}${entry.name}/\n`;
                tree += await buildTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1, maxDepth);
            } else {
                tree += `${prefix}${connector}${entry.name}\n`;
            }
        }

        return tree;
    }

    return tool({
        description: 'List the files and directories in a given path as an ASCII tree (max depth 3).',
        parameters: z.object({
            dirPath: z.string().optional().default('.').describe('Directory path to list. Defaults to cwd.'),
        }),
        execute: async ({ dirPath }) => {
            try {
                const resolvedDir = safeResolve(undefined, (typeof dirPath === 'string' && dirPath.trim().length > 0) ? dirPath : '.');
                const rootName = path.basename(resolvedDir);
                const tree = await buildTree(resolvedDir);
                const result = `${rootName}/\n${tree}`;

                console.log(chalk.cyan(`\n📂 Directory: ${resolvedDir}\n`));
                console.log(result);

                return result || `Directory "${dirPath}" is empty.`;
            } catch (error) {
                return `Error listing directory "${dirPath}": ${error.message}`;
            }
        },
    });
}

function makeGrepSearchTool() {
    async function searchFiles(dir, pattern, extensions, results, maxResults = 50) {
        if (results.length >= maxResults) return;

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= maxResults) break;

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (IGNORE_DIRS.has(entry.name)) continue;
                await searchFiles(fullPath, pattern, extensions, results, maxResults);
            } else {
                if (extensions.length > 0 && !extensions.includes(path.extname(entry.name))) {
                    continue;
                }

                try {
                    const content = await fs.readFile(fullPath, 'utf8');
                    const lines = content.split('\n');

                    for (let i = 0; i < lines.length; i++) {
                        if (results.length >= maxResults) break;
                        if (lines[i].includes(pattern)) {
                            results.push({
                                filePath: path.relative(process.cwd(), fullPath),
                                lineNumber: i + 1,
                                lineContent: lines[i].trim().substring(0, 200),
                            });
                        }
                    }
                } catch {
                    // Skip binary or unreadable files
                }
            }
        }
    }

    return tool({
        description: 'Search for a keyword or text pattern across files in the workspace.',
        parameters: z.object({
            pattern: z.string().describe('The text pattern to search for (case-sensitive)'),
            dirPath: z.string().optional().default('.').describe('Directory to search in. Defaults to cwd.'),
            fileExtensions: z.array(z.string()).optional().default([]).describe('File extensions to filter, e.g. [".js", ".ts"]. Empty = all.'),
        }),
        execute: async ({ pattern, dirPath, fileExtensions }) => {
            try {
                const resolvedDir = path.resolve(process.cwd(), dirPath || '.');
                const results = [];

                await searchFiles(resolvedDir, pattern, fileExtensions || [], results);

                if (results.length === 0) {
                    return `No matches found for "${pattern}" in ${dirPath || '.'}.`;
                }

                console.log(chalk.cyan(`\n🔍 Found ${results.length} match(es) for "${pattern}":\n`));

                const formatted = results.map(r =>
                    `  ${chalk.gray(r.filePath)}:${chalk.yellow(r.lineNumber)} → ${r.lineContent}`
                ).join('\n');
                console.log(formatted + '\n');

                return JSON.stringify(results, null, 2);
            } catch (error) {
                return `Error searching for "${pattern}": ${error.message}`;
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The tool IDs the agent uses. Mirrors AGENT_TOOL_IDS in chat-with-ai-agent.js.
 */
export const AGENT_TOOL_IDS = [
    'read_files',
    'edit_file',
    'replace_content',
    'execute_command',
    'list_dir',
    'grep_search',
];

/**
 * Build the full tools map for the agent.
 * When autoApprove is true, file-edit and command-execution tools skip
 * the user confirmation prompt.
 *
 * @param {boolean} autoApprove - Skip confirmation prompts
 * @returns {Object} Map of toolId → tool instance
 */
export function getAgentTools(autoApprove = false) {
    return {
        read_files: makeReadFileTool(),
        edit_file: makeEditFileTool(autoApprove),
        replace_content: makeReplaceContentTool(autoApprove),
        execute_command: makeExecuteCommandTool(autoApprove),
        list_dir: makeListDirTool(),
        grep_search: makeGrepSearchTool(),
    };
}
