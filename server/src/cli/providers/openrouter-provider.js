import { BaseProvider } from "./base-provider.js";
import { configManager } from "../config/config-manager.js";
import chalk from "chalk";

export class OpenRouterProvider extends BaseProvider {
    constructor() {
        super();
        const config = configManager.getConfig();
        this.apiKey = config?.openrouter?.apiKey;
        this.modelId = config?.openrouter?.model;

        if (!this.apiKey) {
            throw new Error("OpenRouter API Key is not configured. Use /model to set it up.");
        }
        
        if (!this.modelId) {
            throw new Error("No OpenRouter model selected. Use /model to select one.");
        }
    }

    async sendMessage(messages, onChunk, tools = undefined, onToolCall = null) {
        try {
            // map internal messages to API format
            const apiMessages = messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            // Handle tools if any
            const requestBody = {
                model: this.modelId,
                messages: apiMessages,
                stream: true
            };

            if (tools && Object.keys(tools).length > 0) {
                requestBody.tools = Object.entries(tools).map(([name, tool]) => ({
                    type: "function",
                    function: {
                        name,
                        description: tool.description,
                        parameters: tool.parameters
                    }
                }));
            }

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "HTTP-Referer": "https://wemiy.ai",
                    "X-Title": "wemiy-cli",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                let errorMsg = response.statusText;
                try {
                    const errorDetail = await response.json();
                    errorMsg = errorDetail.error?.message || JSON.stringify(errorDetail);
                } catch(e) {}
                
                throw new Error(`OpenRouter API error ${response.status}: ${errorMsg}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullResponse = "";
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                // Keep the last incomplete line in the buffer
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.trim() === "data: [DONE]") continue;
                    
                    if (line.startsWith("data: ")) {
                        const dataStr = line.substring(6).trim();
                        if (!dataStr) continue;

                        try {
                            const data = JSON.parse(dataStr);
                            const chunk = data.choices[0]?.delta?.content || "";
                            
                            // Handling tool calls if OpenRouter streams them (simplified, often needs accumulating tool args)
                            if (chunk) {
                                fullResponse += chunk;
                                if (onChunk) {
                                    onChunk(chunk);
                                }
                            }
                        } catch (e) {
                            console.error(chalk.yellow("Failed to parse SSE line:"), line, e.message);
                        }
                    }
                }
            }

            return {
                content: fullResponse,
                finishReason: "stop",
                usage: {},
                toolCalls: [], 
                toolResults: [],
                steps: []
            };

        } catch (error) {
            console.error(chalk.red(`\nOpenRouter Provider Error:`), error.message);
            throw error;
        }
    }

    async getMessage(messages, tools = undefined) {
        let fullResponse = "";
        await this.sendMessage(messages, (chunk) => {
            fullResponse += chunk;
        }, tools);
        return fullResponse;
    }

    async generateStructured(schema, prompt) {
        throw new Error("generateStructured format not supported via OpenRouter directly yet.");
    }
}
