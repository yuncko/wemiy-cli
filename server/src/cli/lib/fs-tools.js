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

    const touchMatch = trimmed.match(/^touch\s+(.+)$/);
    if (touchMatch) {
        const file = touchMatch[1].trim();
        return `type nul > ${file}`;
    }

    const mkdirPMatch = trimmed.match(/^mkdir\s+-p\s+(.+)$/);
    if (mkdirPMatch) {
        const dir = mkdirPMatch[1].trim();
        return `mkdir ${dir}`;
    }

    return command;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ FILE TOOL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool definition for reading one or more files from the workspace.
 * Returns the contents of the requested files concatenated together.
 */
export const readFileTool = {
    id: 'read_files',
    name: 'Read Files',
    description: 'Read contents of one or multiple files using paths.',
    enabled: false,
    getTool: () => tool({
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
        }
    })
};

// ─────────────────────────────────────────────────────────────────────────────
// EDIT FILE TOOL (DEPRECATED for large files — prefer replaceContentTool)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool definition for full-file replacement edits.
 * @deprecated For large files, prefer `replaceContentTool` which does targeted block replacement.
 */
export const editFileTool = {
    id: 'edit_file',
    name: 'Edit File (Full Rewrite)',
    description: '[DEPRECATED — prefer "Replace Content" for large files] Replaces the entire file with new content. Shows a diff and asks for user confirmation.',
    enabled: false,
    getTool: () => tool({
        description: 'Edit a file by completely replacing its content. DEPRECATED for large files — use replace_content instead for targeted edits.',
        parameters: z.object({
            filePath: z.string().describe('Path to the file to edit'),
            newContent: z.string().describe('The complete new content of the file. DO NOT output partial snippets, provide the entire updated file content.'),
        }),
        execute: async ({ filePath, newContent }) => {
            try {
                if (typeof filePath !== 'string' || filePath.trim().length === 0) {
                    return 'Failed to edit file: filePath must be a non-empty string.';
                }
                const resolvedPath = safeResolve(undefined, filePath);
                let oldContent = "";
                
                try {
                    oldContent = await fs.readFile(resolvedPath, 'utf8');
                } catch (e) {
                    // File might not exist
                    console.log(chalk.gray(`\nFile ${filePath} not found. Will be created.`));
                }

                // Show diff
                console.log('\n');
                console.log(generateDiffPreview(oldContent, newContent));

                // Ask for confirmation
                const shouldApply = await confirm({
                    message: chalk.cyan(`Apply these changes to ${filePath}?`),
                    initialValue: true,
                });

                if (!shouldApply) {
                    console.log(chalk.yellow(`\n⚠️  Changes to ${filePath} aborted by user.\n`));
                    return `User rejected the file edit for ${filePath}. Suggest an alternative or ask the user what to do.`;
                }

                // Safe Undo Stack recording
                undoManager.push(resolvedPath, oldContent);

                // Write file
                await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
                await fs.writeFile(resolvedPath, newContent, 'utf8');

                console.log(chalk.green(`\n✅ Saved changes to ${filePath}\n`));
                return `Successfully updated ${filePath}.`;

            } catch (error) {
                console.error(chalk.red(`\n❌ Error editing file: ${error.message}\n`));
                return `Failed to edit file ${filePath}. Error: ${error.message}`;
            }
        }
    })
};

// ─────────────────────────────────────────────────────────────────────────────
// REPLACE CONTENT TOOL (Block-Replace — Targeted Editing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool definition for targeted block-replacement edits.
 * Finds an exact substring in the file and replaces it, avoiding full-file rewrites.
 * Shows a diff preview and integrates with the undo system.
 */
export const replaceContentTool = {
    id: 'replace_content',
    name: 'Replace Content',
    description: 'Replace a specific block of text in a file with new content. Much more efficient than full-file rewrite for targeted edits.',
    enabled: false,
    getTool: () => tool({
        description: 'Replace a specific block of text inside a file. You must provide the exact text to find and its replacement. This is the preferred way to edit files.',
        parameters: z.object({
            filePath: z.string().describe('Path to the file to edit (relative or absolute)'),
            targetContent: z.string().describe('The exact block of text to find in the file. Must match exactly including whitespace and indentation.'),
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
                } catch (e) {
                    return `Error: File "${filePath}" not found. Cannot perform replacement on a non-existent file.`;
                }

                // Locate the target content using exact string match
                const index = fileContent.indexOf(targetContent);
                if (index === -1) {
                    return `Error: Could not find the target content in "${filePath}". Make sure you are providing the EXACT text (including whitespace/indentation) that exists in the file. Read the file first to get the exact content.`;
                }

                // Check for multiple occurrences
                const secondIndex = fileContent.indexOf(targetContent, index + 1);
                if (secondIndex !== -1) {
                    return `Warning: Found multiple occurrences of the target content in "${filePath}". Please provide a more unique/longer block of text to ensure the correct one is replaced.`;
                }

                // Build the new file content
                const newContent = fileContent.substring(0, index) + replacementContent + fileContent.substring(index + targetContent.length);

                // Show diff of only the changed region (with some context)
                console.log('\n');
                console.log(generateDiffPreview(fileContent, newContent));

                // Ask for confirmation
                const shouldApply = await confirm({
                    message: chalk.cyan(`Apply this replacement to ${filePath}?`),
                    initialValue: true,
                });

                if (!shouldApply) {
                    console.log(chalk.yellow(`\n⚠️  Replacement in ${filePath} aborted by user.\n`));
                    return `User rejected the replacement in ${filePath}. Ask the user what to do.`;
                }

                // Record undo state
                undoManager.push(resolvedPath, fileContent);

                // Write updated content
                await fs.writeFile(resolvedPath, newContent, 'utf8');

                console.log(chalk.green(`\n✅ Replaced content in ${filePath}\n`));
                return `Successfully replaced content in ${filePath}.`;

            } catch (error) {
                console.error(chalk.red(`\n❌ Error replacing content: ${error.message}\n`));
                return `Failed to replace content in ${filePath}. Error: ${error.message}`;
            }
        }
    })
};

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTE COMMAND TOOL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool definition for executing shell commands in the workspace.
 * Always prompts the user for confirmation before running.
 */
export const executeCommandTool = {
    id: 'execute_command',
    name: 'Execute Command',
    description: 'Execute a terminal command (like npm test, tsc, or git status). Always asks for user confirmation.',
    enabled: false,
    getTool: () => tool({
        description: 'Run a shell command in the current workspace. Use this to verify code by running tests, linters, or build scripts.',
        parameters: z.object({
            command: z.string().describe('The shell command to execute, e.g. "npm test" or "npx tsc"'),
        }),
        execute: async ({ command }) => {
            try {
                const translated = translateCommandForWindows(command);
                console.log('\n');
                console.log(chalk.cyan(`🤖 AI wants to run command: ${chalk.bold(translated)}`));

                const shouldRun = await confirm({
                    message: chalk.cyan(`Allow execution of this command?`),
                    initialValue: true,
                });

                if (!shouldRun) {
                    console.log(chalk.yellow(`\n⚠️  Command execution aborted by user.\n`));
                    return `User rejected the execution of command: ${translated}. Suggest an alternative or ask the user what to do.`;
                }

                console.log(chalk.gray(`\nRunning: ${translated}\n`));
                
                const { stdout, stderr } = await execAsync(translated, {
                    cwd: process.cwd(),
                    timeout: 60000, // 60s timeout to prevent hanging
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
                
                console.log(chalk.green(`\n✅ Command completed\n`));
                return result;

            } catch (error) {
                console.error(chalk.red(`\n❌ Command failed: ${error.message}\n`));
                if (error.stdout) console.log(error.stdout);
                if (error.stderr) console.error(chalk.yellow(error.stderr));
                
                return `Command failed with error: ${error.message}\nStdout: ${error.stdout || ''}\nStderr: ${error.stderr || ''}`;
            }
        }
    })
};

// ─────────────────────────────────────────────────────────────────────────────
// LIST DIRECTORY TOOL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Directories and file patterns to ignore when listing the workspace tree.
 */
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.cache', '__pycache__', '.turbo']);
const IGNORE_FILES = new Set(['.env', '.env.local', '.env.production']);
const IGNORE_EXTENSIONS = new Set(['.lock']);

/**
 * Recursively walk a directory and build an ASCII tree string.
 * @param {string} dir - Absolute directory path
 * @param {string} prefix - Current indentation prefix for tree rendering
 * @param {number} depth - Current depth level
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {Promise<string>} Formatted ASCII tree
 */
async function buildTree(dir, prefix = '', depth = 0, maxDepth = 3) {
    if (depth >= maxDepth) return '';

    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return `${prefix}[permission denied]\n`;
    }

    // Filter out ignored entries
    entries = entries.filter(entry => {
        if (IGNORE_DIRS.has(entry.name) && entry.isDirectory()) return false;
        if (IGNORE_FILES.has(entry.name)) return false;
        if (IGNORE_EXTENSIONS.has(path.extname(entry.name))) return false;
        return true;
    });

    // Sort: directories first, then files alphabetically
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

/**
 * Tool definition for listing the workspace directory tree.
 * Returns a clean ASCII tree up to 3 levels deep, ignoring common noise directories.
 */
export const listDirTool = {
    id: 'list_dir',
    name: 'List Directory',
    description: 'List the contents of a directory as a tree structure. Ignores node_modules, .git, dist, and lock files.',
    enabled: false,
    getTool: () => tool({
        description: 'List the files and directories in a given path as an ASCII tree (max depth 3). Use this to explore the project structure before reading or editing files.',
        parameters: z.object({
            dirPath: z.string().optional().default('.').describe('Directory path to list (relative or absolute). Defaults to current working directory.'),
        }),
        execute: async ({ dirPath }) => {
            try {
                const resolvedDir = path.resolve(process.cwd(), dirPath || '.');
                const rootName = path.basename(resolvedDir);

                const tree = await buildTree(resolvedDir);
                const result = `${rootName}/\n${tree}`;

                console.log(chalk.cyan(`\n📂 Directory: ${resolvedDir}\n`));
                console.log(result);

                return result || `Directory "${dirPath}" is empty.`;
            } catch (error) {
                return `Error listing directory "${dirPath}": ${error.message}`;
            }
        }
    })
};

// ─────────────────────────────────────────────────────────────────────────────
// GREP SEARCH TOOL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively search files for a text pattern.
 * @param {string} dir - Directory to search
 * @param {string} pattern - Text pattern to search for
 * @param {string[]} extensions - File extensions to include (e.g. ['.js', '.ts'])
 * @param {Array} results - Accumulator for matches
 * @param {number} maxResults - Cap on total matches returned
 * @returns {Promise<void>}
 */
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
            // Skip ignored directories
            if (IGNORE_DIRS.has(entry.name)) continue;
            await searchFiles(fullPath, pattern, extensions, results, maxResults);
        } else {
            // Filter by extension if specified
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
                            lineContent: lines[i].trim().substring(0, 200), // cap line length
                        });
                    }
                }
            } catch {
                // Skip files that can't be read (e.g. binary files)
            }
        }
    }
}

/**
 * Tool definition for searching the codebase for a text pattern.
 * Returns matching file paths, line numbers, and line content.
 */
export const grepSearchTool = {
    id: 'grep_search',
    name: 'Grep Search',
    description: 'Search for a text pattern across files in the workspace. Returns matching file paths, line numbers, and content.',
    enabled: false,
    getTool: () => tool({
        description: 'Search for a keyword, function name, or text pattern across files in the workspace. Use this to find where something is defined or used.',
        parameters: z.object({
            pattern: z.string().describe('The text pattern or keyword to search for (case-sensitive exact match)'),
            dirPath: z.string().optional().default('.').describe('Directory to search in (relative or absolute). Defaults to cwd.'),
            fileExtensions: z.array(z.string()).optional().default([]).describe('File extensions to filter, e.g. [".js", ".ts"]. Empty = all text files.'),
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

                // Return structured results for AI consumption
                return JSON.stringify(results, null, 2);
            } catch (error) {
                return `Error searching for "${pattern}": ${error.message}`;
            }
        }
    })
};
