import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';

class UndoManager {
    constructor() {
        this.stack = [];
    }

    /**
     * Push a file state to the undo stack before modifying it
     * @param {string} filePath - Path of the file being modified
     * @param {string} previousContent - The content before modification
     */
    push(filePath, previousContent) {
        this.stack.push({
            filePath: path.resolve(filePath),
            content: previousContent,
            timestamp: Date.now()
        });
    }

    /**
     * Restore the last modified file to its previous state
     */
    async undoLast() {
        if (this.stack.length === 0) {
            console.log(chalk.yellow("\nUndo stack is empty. Nothing to undo.\n"));
            return false;
        }

        const lastAction = this.stack.pop();
        try {
            await fs.writeFile(lastAction.filePath, lastAction.content, 'utf8');
            console.log(chalk.green(`\n✅ Undid modifications to: ${lastAction.filePath}\n`));
            return true;
        } catch (error) {
            console.error(chalk.red(`\n❌ Failed to undo modifications to ${lastAction.filePath}: ${error.message}\n`));
            
            // Push it back since it failed
            this.stack.push(lastAction);
            return false;
        }
    }
}

export const undoManager = new UndoManager();
