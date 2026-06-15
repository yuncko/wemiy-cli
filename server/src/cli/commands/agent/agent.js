import { Command } from 'commander';
import chalk from 'chalk';
import { text, isCancel } from '@clack/prompts';
import { runAgent, parseMaxIterations } from '../../agent/agent-engine.js';
import { generateApplication as scaffoldApplication } from '../../../config/agent.config.js';
import { configManager } from '../../config/config-manager.js';
import { AGENT_MODES, DEFAULT_MAX_ITERATIONS } from '../../agent/agent-runtime.js';

/**
 * Action handler for `wemiy agent "<task>"`.
 * Accepts an optional inline task argument; if absent, prompts interactively.
 *
 * Subcommand `wemiy agent scaffold "<description>"` creates a fresh project
 * via the structured-output app generator (Gemini only).
 */
const agentAction = async (task, options) => {
    let taskDescription = task;

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

    const requestedMode = (options.mode || AGENT_MODES.ACT).toLowerCase();
    if (requestedMode !== AGENT_MODES.ACT && requestedMode !== AGENT_MODES.DISCUSS) {
        console.error(chalk.red(`\n❌ Invalid --mode "${options.mode}". Use "act" or "discuss".\n`));
        process.exit(1);
    }

    await runAgent(taskDescription, {
        autoApprove: !!options.autoApprove,
        maxIterations: parseMaxIterations(options.maxIterations),
        mode: requestedMode,
        conversationId: options.conversation || null,
        confirmPlan: options.yes ? false : !options.autoApprove,
    });
};

/**
 * Subcommand handler: scaffold a brand-new application from a one-line description.
 * Uses generateApplication (structured output) — Gemini only.
 */
const scaffoldAction = async (description) => {
    let desc = description;

    if (!desc) {
        const userInput = await text({
            message: chalk.magenta('🤖 What kind of application should the agent build?'),
            placeholder: 'e.g. "a React todo list with localStorage"',
            validate(value) {
                if (!value || value.trim().length === 0) return 'Description cannot be empty';
                if (value.trim().length < 5) return 'Please describe the app in a bit more detail';
            },
        });

        if (isCancel(userInput)) {
            console.log(chalk.yellow('\n👋 Scaffold cancelled.\n'));
            process.exit(0);
        }
        desc = userInput;
    }

    const cfg = configManager.getConfig();
    const provider = cfg?.provider || 'gemini';
    if (provider !== 'gemini') {
        console.log(chalk.yellow(`\n⚠️  The scaffold subcommand currently requires the Gemini provider (current: ${provider}).`));
        console.log(chalk.yellow(`   Run \`wemiy model\` to switch, or use \`wemiy agent "<task>"\` instead.\n`));
        process.exit(1);
    }

    const { GeminiProvider } = await import('../../providers/gemini-provider.js');
    const aiService = new GeminiProvider();

    await scaffoldApplication(desc, aiService, process.cwd());
};

// ── Export command ───────────────────────────────────────────────────

export const agentCommand = new Command('agent')
    .argument('[task]', 'Task description for the agent')
    .description('Run the autonomous Wemiy Agent to handle a development task end-to-end')
    .option('--auto-approve', 'Skip confirmation prompts for file edits and command execution')
    .option('--max-iterations <n>', `Maximum number of agent iterations (default: ${DEFAULT_MAX_ITERATIONS})`, String(DEFAULT_MAX_ITERATIONS))
    .option('--mode <mode>', 'Agent mode: "act" (edit & run, default) or "discuss" (read-only Q&A)', 'act')
    .option('--conversation <id>', 'Resume an existing conversation by ID for continuity across runs')
    .option('-y, --yes', 'Skip the plan-confirmation prompt before execution')
    .action(agentAction);

agentCommand
    .command('scaffold')
    .argument('[description]', 'High-level description of the application to scaffold')
    .description('Scaffold a fresh project from a one-line description (Gemini only)')
    .action(scaffoldAction);
