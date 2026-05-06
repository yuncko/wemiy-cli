import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

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
}

export const configManager = new ConfigManager();
