import { Command } from 'commander';
import chalk from 'chalk';
import { text, isCancel } from '@clack/prompts';
import { runAgent } from '../../agent/agent-engine.js';

/**
 * Action handler for `wemiy agent "<task>"`.
 * Accepts an optional inline task argument; if absent, prompts interactively.
 */
const agentAction = async (task, options) => {
    let taskDescription = task;

    // If no task was provided as an argument, prompt for one
    if (!taskDescription) {
        const userInput = await text({
            message: chalk.magenta('🤖 What would you like the agent to do?'),
            placeholder: 'Describe a development task...',
            validate(value) {
                if (!value || value.trim().length === 0) {
                    return 'Task description cannot be empty';
                }
                if (value.trim().length < 5) {
                    return 'Please provide more details (at least 5 characters)';
                }
            },
        });

        if (isCancel(userInput)) {
            console.log(chalk.yellow('\n👋 Agent cancelled.\n'));
            process.exit(0);
        }

        taskDescription = userInput;
    }

    // Run the full agent pipeline
    await runAgent(taskDescription, {
        autoApprove: !!options.autoApprove,
        maxIterations: parseInt(options.maxIterations, 10) || 25,
    });
};

// ── Export command ───────────────────────────────────────────────────

export const agentCommand = new Command('agent')
    .argument('[task]', 'Task description for the agent')
    .description('Run the autonomous Wemiy Agent to handle a development task end-to-end')
    .option('--auto-approve', 'Skip confirmation prompts for file edits and command execution')
    .option('--max-iterations <n>', 'Maximum number of agent iterations (default: 25)', '25')
    .action(agentAction);
