import chalk from "chalk";

const isDebug = process.env.ORBITAL_DEBUG === "true";

/**
 * Debug logger — only prints when ORBITAL_DEBUG=true
 * @param  {...any} args - Arguments to log
 */
export function debug(...args) {
    if (isDebug) {
        console.log(chalk.gray("[DEBUG]"), ...args);
    }
}
