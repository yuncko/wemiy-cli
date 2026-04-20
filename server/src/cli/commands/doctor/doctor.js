import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import path from "path";
import { existsSync } from "fs";
import yoctoSpinner from "yocto-spinner";
import { scanFiles } from "../../utils/file-scanner.js";
import { analyzeFiles } from "../../services/analyzer.js";
import { renderCLIReport, renderJSONReport } from "../../services/report-formatter.js";
import { debug } from "../../../lib/debug.js";

/**
 * Main doctor action
 */
const doctorAction = async (options) => {
    const targetPath = path.resolve(options.path || process.cwd());
    const isJSON = !!options.json;
    const shouldFix = !!options.fix;

    // ── Validate path ───────────────────────────────────────────────
    if (!existsSync(targetPath)) {
        console.error(chalk.red(`\n❌ Path does not exist: ${chalk.bold(targetPath)}\n`));
        process.exit(1);
    }

    // ── Header (skip in JSON mode) ──────────────────────────────────
    if (!isJSON) {
        console.log(
            boxen(
                `${chalk.cyan.bold("🩺 Wemiy Doctor")}\n${chalk.gray(`Scanning: ${targetPath}`)}`,
                {
                    padding: 1,
                    borderStyle: "round",
                    borderColor: "cyan",
                }
            )
        );
    }

    // ── Phase 1: Scan files ─────────────────────────────────────────
    const scanSpinner = !isJSON
        ? yoctoSpinner({ text: "Scanning project files..." }).start()
        : null;

    let files;
    try {
        files = await scanFiles(targetPath);
    } catch (err) {
        if (scanSpinner) scanSpinner.stop();
        console.error(chalk.red(`\n❌ Failed to scan directory: ${err.message}\n`));
        process.exit(1);
    }

    if (scanSpinner) scanSpinner.stop();

    if (files.length === 0) {
        if (!isJSON) {
            console.log(chalk.yellow("\n⚠️  No supported files found to analyze.\n"));
        } else {
            renderJSONReport([], 0, 0);
        }
        return;
    }

    if (!isJSON) {
        console.log(chalk.gray(`  Found ${chalk.white.bold(files.length)} files to analyze\n`));
    }

    debug(`[doctor] Files to analyze: ${files.map(f => f.relativePath).join(", ")}`);

    // ── Phase 2: AI Analysis ────────────────────────────────────────
    const analysisSpinner = !isJSON
        ? yoctoSpinner({ text: `Analyzing files with AI (0/${files.length})...` }).start()
        : null;

    const startTime = Date.now();

    let issues;
    try {
        issues = await analyzeFiles(files, (completed, total) => {
            if (analysisSpinner) {
                analysisSpinner.text = `Analyzing files with AI (${completed}/${total})...`;
            }
        });
    } catch (err) {
        if (analysisSpinner) analysisSpinner.stop();
        console.error(chalk.red(`\n❌ Analysis failed: ${err.message}\n`));
        process.exit(1);
    }

    const elapsedMs = Date.now() - startTime;

    if (analysisSpinner) analysisSpinner.stop();

    // ── Phase 3: Report ─────────────────────────────────────────────
    if (isJSON) {
        renderJSONReport(issues, files.length, elapsedMs);
    } else {
        renderCLIReport(issues, files.length, elapsedMs);
    }

    // ── Phase 4: Auto-fix (if --fix) ────────────────────────────────
    if (shouldFix && issues.length > 0) {
        const affectedFiles = [...new Set(issues.map(i => i.file))];

        if (!isJSON) {
            console.log(
                boxen(
                    `${chalk.cyan.bold("🔧 Auto-Fix Mode")}\n${chalk.gray(`Fixing ${affectedFiles.length} affected file(s)...`)}`,
                    {
                        padding: 1,
                        borderStyle: "round",
                        borderColor: "cyan",
                    }
                )
            );
        }

        // Dynamically import the fix logic to avoid circular deps
        try {
            const { fixCommand } = await import("../fix/fixFile.js");

            for (const file of affectedFiles) {
                const absolutePath = path.resolve(targetPath, file);
                if (!isJSON) {
                    console.log(chalk.cyan(`\n→ Fixing: ${chalk.bold(file)}`));
                }

                try {
                    // Programmatically invoke the fix command's action
                    await fixCommand.parseAsync(["node", "wemiy", absolutePath], { from: "user" });
                } catch (err) {
                    if (!isJSON) {
                        console.error(chalk.yellow(`  ⚠ Could not fix ${file}: ${err.message}`));
                    }
                    debug(`[doctor] Fix failed for ${file}: ${err.message}`);
                }
            }

            if (!isJSON) {
                console.log(chalk.green.bold("\n✅ Auto-fix pass complete.\n"));
            }
        } catch (err) {
            console.error(chalk.red(`\n❌ Auto-fix module failed to load: ${err.message}\n`));
            debug(`[doctor] Fix import error: ${err.message}`);
        }
    }
};

// ── Export command ───────────────────────────────────────────────────

export const doctorCommand = new Command("doctor")
    .description("Analyze project for bugs, performance issues, security risks & bad practices")
    .option("--fix", "Auto-fix detected issues using wemiy fix")
    .option("--json", "Output results as JSON")
    .option("--path <dir>", "Custom directory to scan (defaults to current directory)")
    .action(doctorAction);
