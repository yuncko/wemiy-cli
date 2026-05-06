import { configManager } from "../config/config-manager.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

/**
 * SwiftRouter provider over the shared OpenAI-compatible path.
 */
export class SwiftRouterProvider extends OpenAICompatibleProvider {
    constructor() {
        const config = configManager.getConfig();
        super({
            providerLabel: "SwiftRouter",
            apiKey: config?.swiftrouter_api_key || config?.swiftrouter?.apiKey,
            modelId: config?.swiftrouter?.model,
            maxTokens: config?.swiftrouter?.maxTokens,
            baseURL: "https://api.swiftrouter.com/v1",
            missingKeyMessage: "SwiftRouter API Key is not configured. Use /model to set it up.",
            missingModelMessage: "No SwiftRouter model selected. Use /model to select one.",
        });
    }
}
