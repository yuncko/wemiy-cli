import chalk from "chalk";
import boxen from "boxen";

// ── Type icons and labels ───────────────────────────────────────────
const TYPE_META = {
    bug:            { icon: "🐛", label: "Bugs",           color: chalk.red },
    security:       { icon: "🔒", label: "Security Risks", color: chalk.redBright },
    performance:    { icon: "⚡", label: "Performance",     color: chalk.yellow },
    "bad-practice": { icon: "⚠️",  label: "Bad Practices",  color: chalk.magenta },
};

const SEVERITY_BADGE = {
    critical: chalk.bgRed.white.bold(" CRITICAL "),
    warning:  chalk.bgYellow.black.bold(" WARNING "),
    info:     chalk.bgBlue.white(" INFO "),
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/**
 * Render a beautiful CLI report from analysis issues.
 *
 * @param {Array}  issues       — array of issue objects
 * @param {number} filesScanned — total files scanned
 * @param {number} elapsedMs    — scan duration in ms
 */
export function renderCLIReport(issues, filesScanned, elapsedMs) {
    const elapsed = (elapsedMs / 1000).toFixed(1);

    // ── Summary header ──────────────────────────────────────────────
    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const warningCount  = issues.filter(i => i.severity === "warning").length;
    const infoCount     = issues.filter(i => i.severity === "info").length;

    const summaryLines = [
        chalk.bold.cyan("🩺 Wemiy Doctor — Project Health Report"),
        "",
        `${chalk.gray("Files scanned:")}  ${chalk.white.bold(filesScanned)}`,
        `${chalk.gray("Issues found:")}   ${chalk.white.bold(issues.length)}`,
        `${chalk.gray("Scan time:")}      ${chalk.white.bold(elapsed + "s")}`,
        "",
        [
            criticalCount > 0 ? chalk.red.bold(`${criticalCount} critical`) : null,
            warningCount  > 0 ? chalk.yellow.bold(`${warningCount} warnings`) : null,
            infoCount     > 0 ? chalk.blue(`${infoCount} info`) : null,
        ].filter(Boolean).join(chalk.gray("  ·  ")) || chalk.green.bold("All clear!"),
    ];

    console.log(
        boxen(summaryLines.join("\n"), {
            padding: 1,
            borderStyle: "round",
            borderColor: issues.length === 0 ? "green" : criticalCount > 0 ? "red" : "yellow",
        })
    );

    if (issues.length === 0) {
        console.log(chalk.green.bold("\n  ✅ No issues detected — your project looks healthy!\n"));
        return;
    }

    // ── Group by type ───────────────────────────────────────────────
    const grouped = {};
    for (const issue of issues) {
        const type = issue.type || "bug";
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(issue);
    }

    // Render each type group
    const typeOrder = ["bug", "security", "performance", "bad-practice"];

    for (const type of typeOrder) {
        const items = grouped[type];
        if (!items || items.length === 0) continue;

        const meta = TYPE_META[type] || { icon: "❓", label: type, color: chalk.white };

        // Sort by severity within the group
        items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

        console.log(`\n${meta.icon}  ${meta.color.bold(meta.label)} ${chalk.gray(`(${items.length})`)}`);
        console.log(chalk.gray("─".repeat(50)));

        for (const issue of items) {
            const badge = SEVERITY_BADGE[issue.severity] || SEVERITY_BADGE.info;
            const location = issue.line
                ? chalk.cyan(`${issue.file}:${issue.line}`)
                : chalk.cyan(issue.file);

            console.log(`\n  ${badge}  ${location}`);
            console.log(`  ${chalk.white(issue.message)}`);
            if (issue.suggestion) {
                console.log(`  ${chalk.gray("→")} ${chalk.green(issue.suggestion)}`);
            }
        }
    }

    // ── Suggested commands ──────────────────────────────────────────
    const affectedFiles = [...new Set(issues.map(i => i.file))];

    console.log(`\n${chalk.gray("─".repeat(50))}`);
    console.log(chalk.bold("\n💡 Suggested Commands:\n"));

    for (const file of affectedFiles.slice(0, 10)) {
        console.log(`  ${chalk.cyan("$")} ${chalk.white(`wemiy fix ${file}`)}`);
    }

    if (affectedFiles.length > 10) {
        console.log(chalk.gray(`  ... and ${affectedFiles.length - 10} more files`));
    }

    console.log(
        chalk.gray(`\n  Tip: Run ${chalk.cyan("wemiy doctor --fix")} to auto-fix all issues.\n`)
    );
}

/**
 * Render issues as a JSON object to stdout.
 *
 * @param {Array}  issues       — array of issue objects
 * @param {number} filesScanned — total files scanned
 * @param {number} elapsedMs    — scan duration in ms
 */
export function renderJSONReport(issues, filesScanned, elapsedMs) {
    const report = {
        summary: {
            filesScanned,
            totalIssues: issues.length,
            critical: issues.filter(i => i.severity === "critical").length,
            warnings: issues.filter(i => i.severity === "warning").length,
            info: issues.filter(i => i.severity === "info").length,
            scanTimeMs: elapsedMs,
        },
        issues,
    };

    console.log(JSON.stringify(report, null, 2));
}
