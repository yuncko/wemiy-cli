import chalk from "chalk";
import boxen from "boxen";
import { select, password, isCancel } from "@clack/prompts";
import { configManager } from "../config/config-manager.js";
import { getAllModels, getModelById, MODEL_PROVIDERS } from "../core/model-registry.js";

export class SlashCommandManager {
    constructor() {
        this.commands = new Map();
        
        // Register default commands
        this.register('help', 'Show available slash commands', (args, context) => {
            let helpText = chalk.cyan.bold("Available Slash Commands:\n\n");
            
            for (const [cmd, details] of this.commands.entries()) {
                helpText += `  ${chalk.green('/' + cmd.padEnd(8))} - ${chalk.gray(details.description)}\n`;
            }
            
            console.log(boxen(helpText.trim(), {
                padding: 1,
                borderStyle: 'round',
                borderColor: 'cyan'
            }));
        });
        
        this.register('exit', 'Exit the CLI', (args, context) => {
            console.log(boxen(chalk.yellow("Chat session ended. Goodbye! 👋"), {
                padding: 1,
                margin: 1,
                borderStyle: "round",
                borderColor: "yellow",
            }));
            if (context?.exit) {
                context.exit();
            } else {
                process.exit(0);
            }
        });
        
        this.register('config', 'CLI Configuration Wizard', (args, context) => {
             if (context?.config) {
                 console.log(chalk.cyan("Current config:"), context.config);
             } else {
                 console.log(chalk.yellow("\n⚠️  Config wizard is under construction.\n"));
             }
        });
        
        this.register('undo', 'Undo the last file modification', async (args, context) => {
             if (context?.undoStack) {
                 await context.undoStack.undoLast();
             } else {
                 console.log(chalk.red("Undo stack not provided."));
             }
        });
    }

    register(name, description, executeFn) {
        this.commands.set(name.toLowerCase(), { description, execute: executeFn });
    }

    /**
     * Parse and execute a string if it's a slash command
     * @param {string} input - user input text
     * @param {Object} context - execution context (undoStack, exit, config)
     * @returns {boolean} true if executed (or matched), false otherwise
     */
    async handleSlashCommand(input, context) {
        if (!input || !input.trim().startsWith('/')) return false;

        const trimmedInput = input.trim();
        const args = trimmedInput.slice(1).split(' ').filter(Boolean);
        const name = args[0].toLowerCase();

        if (this.commands.has(name)) {
            const cmd = this.commands.get(name);
            await cmd.execute(args.slice(1), context);
            return true;
        }

        console.log(chalk.red(`\nUnknown command: /${name}. Type /help for a list of available commands.\n`));
        return true; // We matched a starting slash, so we handled the control flow
    }
}

// Export a singleton instance
export const slashCommandManager = new SlashCommandManager();
