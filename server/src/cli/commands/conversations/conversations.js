import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import { select, text, isCancel } from '@clack/prompts';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ChatService } from '../../../services/chat.service.js';
import { getUserFromToken } from '../../chat/chat-base.js';
import { runAgent, parseMaxIterations } from '../../agent/agent-engine.js';
import { AGENT_MODES, DEFAULT_MAX_ITERATIONS } from '../../agent/agent-runtime.js';

const chatService = new ChatService();

function formatIso(d) {
    try {
        return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
    } catch {
        return String(d);
    }
}

async function listAction() {
    const user = await getUserFromToken();
    const list = await chatService.getUserConversations(user.id);
    const storeFile = path.join(os.homedir(), '.orbital-cli', 'chats.json');
    let storeBytes = '';
    try {
        const st = await fs.stat(storeFile);
        storeBytes = `Store: ${storeFile} (${(st.size / 1024).toFixed(1)} KB)`;
    } catch {
        storeBytes = `Store: ${storeFile} (not created yet)`;
    }

    if (list.length === 0) {
        console.log(chalk.yellow('No conversations found.'));
        console.log(chalk.gray(storeBytes));
        return;
    }

    console.log(chalk.cyan(storeBytes) + '\n');
    const rows = [];
    for (const c of list) {
        const n = await chatService.countMessages(c.id);
        rows.push({
            id: c.id,
            title: (c.title || '(untitled)').slice(0, 56),
            mode: c.mode || 'chat',
            updated: formatIso(c.updatedAt),
            msgs: n,
        });
    }

    const idW = 36;
    const titleW = 40;
    const modeW = 14;
    console.log(
        chalk.bold('ID'.padEnd(idW)) +
            chalk.bold('TITLE'.padEnd(titleW)) +
            chalk.bold('MODE'.padEnd(modeW)) +
            chalk.bold('UPDATED') +
            chalk.bold('  MSGS')
    );
    console.log(chalk.gray('-'.repeat(idW + titleW + modeW + 28)));
    for (const r of rows) {
        console.log(
            chalk.green(r.id) +
                '  ' +
                chalk.white(r.title.padEnd(titleW)) +
                chalk.gray(r.mode.padEnd(modeW)) +
                chalk.gray(r.updated) +
                chalk.yellow(`  ${r.msgs}`)
        );
    }
    console.log(chalk.gray(`\nTotal: ${list.length} conversation(s).`));
    console.log(chalk.gray('Resume: wemiy agent "your task" --conversation <ID>'));
    console.log(chalk.gray('Or:     wemiy conversations resume'));
}

async function showAction(id, options) {
    const user = await getUserFromToken();
    const conv = await chatService.getConversation(id, user.id);
    if (!conv) {
        console.error(chalk.red(`No conversation found for id: ${id}`));
        process.exit(1);
    }

    const messages = conv.messages || [];

    if (options.json) {
        console.log(JSON.stringify({ conversation: conv, messages }, null, 2));
        return;
    }

    const header =
        `${chalk.bold('Title:')} ${conv.title}\n` +
        `${chalk.bold('ID:')} ${conv.id}\n` +
        `${chalk.bold('Mode:')} ${conv.mode}\n` +
        `${chalk.bold('Messages:')} ${messages.length}`;
    console.log(boxen(header, { padding: 1, borderStyle: 'round', borderColor: 'cyan' }));

    for (const m of messages) {
        const ts = formatIso(m.createdAt);
        const role = m.role;
        let body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
        if (options.markdown) {
            console.log(`\n### ${role} (${ts})\n`);
            if (role === 'assistant' && body.includes('```')) {
                console.log(body);
            } else if (body.length > 4000 && !options.full) {
                console.log(body.slice(0, 4000) + '\n\n...(truncated; use --full)\n');
            } else {
                console.log('```text\n' + body + '\n```\n');
            }
        } else {
            const label = role === 'user' ? chalk.blue('USER') : role === 'assistant' ? chalk.green('ASSISTANT') : chalk.magenta(role.toUpperCase());
            console.log(`\n${label} ${chalk.gray(ts)}`);
            console.log(chalk.gray('─'.repeat(50)));
            const maxLen = options.full ? Infinity : 6000;
            if (body.length > maxLen) {
                console.log(body.slice(0, maxLen) + chalk.yellow('\n...(truncated; use --full)\n'));
            } else {
                console.log(body);
            }
        }
    }
}

async function exportAction(id, options) {
    const user = await getUserFromToken();
    const conv = await chatService.getConversation(id, user.id);
    if (!conv) {
        console.error(chalk.red(`No conversation found for id: ${id}`));
        process.exit(1);
    }
    const out = options.output || `${conv.id.slice(0, 8)}-export.json`;
    const payload = {
        exportedAt: new Date().toISOString(),
        conversation: {
            id: conv.id,
            title: conv.title,
            mode: conv.mode,
            userId: conv.userId,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
        },
        messages: conv.messages,
    };
    await fs.writeFile(out, JSON.stringify(payload, null, 2), 'utf8');
    console.log(chalk.green(`Exported ${conv.messages.length} message(s) to ${path.resolve(out)}`));
}

async function forkAction(sourceId, options) {
    const user = await getUserFromToken();
    const forked = await chatService.forkConversation(user.id, sourceId, options.untilMessage || null);
    if (!forked) {
        console.error(chalk.red(`Could not fork: conversation not found: ${sourceId}`));
        process.exit(1);
    }
    console.log(
        boxen(
            `${chalk.bold('Forked conversation')}\n` +
                `New ID: ${chalk.green(forked.id)}\n` +
                `Title: ${forked.title}\n` +
                `Messages copied: ${forked.messages?.length ?? 0}`,
            { padding: 1, borderStyle: 'round', borderColor: 'green' }
        )
    );
    console.log(chalk.gray(`Continue with: wemiy agent "your task" --conversation ${forked.id}`));
}

async function resumeAction(options) {
    const user = await getUserFromToken();
    const list = await chatService.getUserConversations(user.id);
    if (list.length === 0) {
        console.log(chalk.yellow('No conversations to resume. Run `wemiy conversations list` after using the agent.'));
        return;
    }

    const choice = await select({
        message: 'Pick a conversation to continue',
        options: list.map((c) => ({
            value: c.id,
            label: `${(c.title || 'Untitled').slice(0, 50)}`,
            hint: `${c.mode} · ${formatIso(c.updatedAt)}`,
        })),
    });

    if (isCancel(choice)) {
        console.log(chalk.yellow('Cancelled.'));
        process.exit(0);
    }

    const modePick = await select({
        message: 'Agent mode',
        options: [
            { value: AGENT_MODES.ACT, label: 'act (edit & run)', hint: 'default' },
            { value: AGENT_MODES.DISCUSS, label: 'discuss (read-only)' },
        ],
        initialValue: AGENT_MODES.ACT,
    });
    if (isCancel(modePick)) {
        process.exit(0);
    }

    const task = await text({
        message: 'What should the agent do next?',
        placeholder: 'Describe the follow-up task…',
        validate(v) {
            if (!v || v.trim().length < 5) return 'Enter at least 5 characters';
        },
    });
    if (isCancel(task)) process.exit(0);

    const auto = await select({
        message: 'Confirm edits/commands automatically?',
        options: [
            { value: 'no', label: 'No (prompt for each edit/command)', hint: 'safer' },
            { value: 'yes', label: 'Yes (--auto-approve)', hint: 'faster' },
        ],
        initialValue: 'no',
    });
    if (isCancel(auto)) process.exit(0);

    await runAgent(task.trim(), {
        conversationId: choice,
        mode: modePick,
        autoApprove: auto === 'yes',
        maxIterations: parseMaxIterations(options.maxIterations),
        confirmPlan: auto === 'yes' ? false : !options.yes,
    });
}

export const conversationsCommand = new Command('conversations')
    .description('List, inspect, export, fork, and resume saved chat/agent conversations')
    .addCommand(
        new Command('list')
            .description('List saved conversations (newest first)')
            .action(listAction)
    )
    .addCommand(
        new Command('show')
            .argument('<id>', 'Conversation UUID')
            .description('Print messages for a conversation')
            .option('--json', 'Output raw JSON')
            .option('--markdown', 'Output markdown-friendly view')
            .option('--full', 'Do not truncate long message bodies')
            .action(showAction)
    )
    .addCommand(
        new Command('export')
            .argument('<id>', 'Conversation UUID')
            .description('Export conversation and messages to a JSON file')
            .option('-o, --output <file>', 'Output path (default: <short-id>-export.json)')
            .action(exportAction)
    )
    .addCommand(
        new Command('fork')
            .argument('<id>', 'Source conversation UUID')
            .description('Copy a conversation and its messages to a new conversation id')
            .option('--until-message <msgId>', 'Copy only messages up to and including this message id')
            .action(forkAction)
    )
    .addCommand(
        new Command('resume')
            .description('Interactively pick a conversation and run the agent with --conversation')
            .option('--max-iterations <n>', 'Agent iterations', String(DEFAULT_MAX_ITERATIONS))
            .option('-y, --yes', 'Skip plan confirmation (act mode)')
            .action(resumeAction)
    );
