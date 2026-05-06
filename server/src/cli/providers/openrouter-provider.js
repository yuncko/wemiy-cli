import { configManager } from "../config/config-manager.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";


/**
 * OpenRouter provider over the shared OpenAI-compatible path.
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
    constructor() {
        const config = configManager.getConfig();
        super({
            providerLabel: "OpenRouter",
            apiKey: config?.openrouter?.apiKey,
            modelId: config?.openrouter?.model,
            maxTokens: config?.openrouter?.maxTokens,
            baseURL: "https://openrouter.ai/api/v1",
            extraHeaders: {
                "HTTP-Referer": "https://wemiy.ai",
                "X-Title": "wemiy-cli",
            },
            missingKeyMessage: "OpenRouter API Key is not configured. Use /model to set it up.",
            missingModelMessage: "No OpenRouter model selected. Use /model to select one.",
        });
    }
}
