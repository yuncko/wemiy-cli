import chalk from "chalk";
import boxen from "boxen";
import * as Diff from "diff";

/**
 * Generates a colorized diff preview using 'diff' package.
 */
export function generateDiffPreview(oldText, newText) {
    const diffStream = Diff.diffLines(oldText || '', newText || '');
    
    let output = "";
    let hasChanges = false;
    
    diffStream.forEach((part) => {
        // Red for removed, Green for added, Grey for unchanged
        if (part.added) {
            hasChanges = true;
            output += chalk.green(part.value.split('\n').map(l => l ? `+ ${l}` : '').join('\n'));
        } else if (part.removed) {
            hasChanges = true;
            output += chalk.red(part.value.split('\n').map(l => l ? `- ${l}` : '').join('\n'));
        } else {
            // Keep unchanged lines, but slightly dimmed
            const lines = part.value.split('\n');
            if (lines.length > 5) {
               output += chalk.dim(`  ${lines[0]}\n  ${lines[1]}\n  ... ${lines.length - 4} unchanged lines ...\n  ${lines[lines.length - 3]}\n  ${lines[lines.length - 2]}\n`);
            } else {
               output += chalk.dim(part.value.split('\n').map(l => l ? `  ${l}` : '').join('\n'));
            }
        }
    });

    if (!hasChanges) {
        return chalk.gray("No changes detected.");
    }
    
    return boxen(output.trim(), {
        padding: 1,
        borderColor: 'yellow',
        title: '📝 Diff Preview',
        borderStyle: 'round'
    });
}
