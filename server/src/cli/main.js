#!/usr/bin/env node

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the server root (two levels up from src/cli/)
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { Command } from "commander";
import chalk from "chalk";
import figlet from "figlet";
import { readFileSync } from "fs";
import { wakeUp } from "./commands/ai/wakeUp.js";
import { selectModelCommand } from "./commands/model/selectModel.js";
import { fixCommand } from "./commands/fix/fixFile.js";
import { doctorCommand } from "./commands/doctor/doctor.js";
import { commitCommand } from "./commands/git/commit.js";
import { reviewCommand } from "./commands/git/review.js";
import { prReadyCommand } from "./commands/git/pr-ready.js";

const pkg = JSON.parse(readFileSync(path.join(__dirname, "../../package.json"), "utf-8"));

async function main() {
    // Display banner
    console.log(
        chalk.cyan(
            figlet.textSync("Wemiy CLI", {
                font: "Standard",
                horizontalLayout: "default",
            })
        )
    );
    console.log(chalk.gray("  Advanced Agentic AI CLI\n"));

    const program = new Command("wemiys");

    program
        .version(pkg.version)
        .description("Wemiy AI CLI");

    // Add commands

    program.addCommand(wakeUp);
    program.addCommand(fixCommand);
    program.addCommand(doctorCommand);
    program.addCommand(commitCommand);
    program.addCommand(reviewCommand);
    program.addCommand(prReadyCommand);

    program
        .command("model")
        .description("Select AI model (OpenRouter)")
        .action(selectModelCommand);

    // Default action shows help
    program.action(() => {
        program.help();
    });

    program.parse(process.argv);
}

main().catch((error) => {
    console.error(chalk.red("Error running Wemiy CLI:"), error);
    process.exit(1);
});