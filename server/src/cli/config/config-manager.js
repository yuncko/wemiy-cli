import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const SENSITIVE_KEY = /apiKey|api_key|secret|token|password|authorization|credential/i;

/**
 * Return a copy of config safe to print (API keys and similar replaced).
 */
export function redactSensitiveConfig(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
        return obj.map((item) =>
            item && typeof item === "object" ? redactSensitiveConfig(item) : item
        );
    }
    if (typeof obj !== "object") return obj;

    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_KEY.test(key)) {
            out[key] = typeof value === "string" && value.length > 0 ? "***" : value;
            continue;
        }
        if (value && typeof value === "object") {
            out[key] = redactSensitiveConfig(value);
        } else {
            out[key] = value;
        }
    }
    return out;
}

export class ConfigManager {
    constructor() {
        this.configDir = path.join(os.homedir(), '.wemiy');
        this.configFile = path.join(this.configDir, 'config.json');
    }

    getConfig() {
        if (!fs.existsSync(this.configFile)) {
            return {
                provider: "gemini",
                swiftrouter_api_key: "",
                openrouter: {
                    apiKey: "",
                    model: ""
                },
                swiftrouter: {
                    apiKey: "",
                    model: ""
                }
            };
        }
        try {
            return JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
        } catch (error) {
            console.error(chalk.red("Failed to read config file"));
            return { provider: "gemini", swiftrouter_api_key: "" };
        }
    }

    saveConfig(data) {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
        fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), 'utf-8');
    }

    getSelectedModel(provider) {
        const config = this.getConfig();
        if (provider === 'gemini') {
            return config?.gemini?.model;
        }
        if (provider === 'openrouter') {
            return config?.openrouter?.model;
        }
        if (provider === 'swiftrouter') {
            return config?.swiftrouter?.model;
        }
        return null;
    }

    /** Safe for logs or UI — never prints raw API keys */
    getRedactedConfig() {
        return redactSensitiveConfig(this.getConfig());
    }
}

export const configManager = new ConfigManager();
