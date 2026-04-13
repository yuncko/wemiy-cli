import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { confirm } from '@clack/prompts';
import { generateDiffPreview } from './diff-preview.js';
import { undoManager } from './undo-manager.js';
import chalk from 'chalk';

export const readFileTool = {
    id: 'read_files',
    name: 'Read Files',
    description: 'Read contents of one or multiple files using paths.',
    enabled: false,
    getTool: () => tool({
        description: 'Read contents of one or multiple local files.',
        parameters: z.object({
            filePaths: z.array(z.string()).describe('List of absolute or relative file paths to read. Example: ["src/index.js", "package.json"]')
        }),
        execute: async ({ filePaths }) => {
            const results = [];
            for (const fp of filePaths) {
                try {
                    const resolvedPath = path.resolve(process.cwd(), fp);
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

export const editFileTool = {
    id: 'edit_file',
    name: 'Edit File',
    description: 'Modify a file intelligently. Replaces the file with new content. Shows a diff and asks for user confirmation.',
    enabled: false,
    getTool: () => tool({
        description: 'Edit a file by completely replacing its content or replacing specific text.',
        parameters: z.object({
            filePath: z.string().describe('Path to the file to edit'),
            newContent: z.string().describe('The complete new content of the file. DO NOT output partial snippets, provide the entire updated file content.'),
        }),
        execute: async ({ filePath, newContent }) => {
            try {
                const resolvedPath = path.resolve(process.cwd(), filePath);
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
