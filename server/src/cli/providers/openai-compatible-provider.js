import { BaseProvider } from "./base-provider.js";
import chalk from "chalk";

/**
 * Extract a minimal JSON Schema from a Zod schema object.
 * This is a fallback for when the AI SDK doesn't expose .jsonSchema directly.
 * Handles the most common Zod types used in tool parameter definitions.
 * @param {Object} zodSchema - A Zod schema instance
 * @returns {Object} A JSON Schema-compatible object
 */
function extractZodJsonSchema(zodSchema) {
    try {
        const def = zodSchema._def;
        if (!def) return {};

        if (def.typeName === "ZodObject" && def.shape) {
            const properties = {};
            const required = [];
            const shape = typeof def.shape === "function" ? def.shape() : def.shape;

            for (const [key, value] of Object.entries(shape)) {
                const propDef = value._def || {};
                let propSchema = { type: "string" };

                if (propDef.typeName === "ZodString") {
                    propSchema = { type: "string" };
                } else if (propDef.typeName === "ZodNumber") {
                    propSchema = { type: "number" };
                } else if (propDef.typeName === "ZodBoolean") {
                    propSchema = { type: "boolean" };
                } else if (propDef.typeName === "ZodArray") {
                    propSchema = { type: "array", items: { type: "string" } };
                } else if (propDef.typeName === "ZodOptional") {
                    propSchema = { type: "string" };
                } else if (propDef.typeName === "ZodDefault") {
                    propSchema = { type: "string" };
                }

                if (propDef.description) {
                    propSchema.description = propDef.description;
                }

                properties[key] = propSchema;
                if (propDef.typeName !== "ZodOptional" && propDef.typeName !== "ZodDefault") {
                    required.push(key);
                }
            }

            return {
                type: "object",
                properties,
                required: required.length > 0 ? required : undefined,
            };
        }
    } catch {
        // fall through
    }
    return {};
}

/**
 * Shared OpenAI-compatible provider implementation.
 * OpenRouter and SwiftRouter both use this path with different base URLs and API keys.
 */
export class OpenAICompatibleProvider extends BaseProvider {
    constructor({
        providerLabel,
        apiKey,
        modelId,
        maxTokens = 2048,
        baseURL,
        extraHeaders = {},
        missingKeyMessage,
        missingModelMessage,
    }) {
        super();
        this.providerLabel = providerLabel;
        this.apiKey = apiKey;
        this.modelId = modelId;
        this.maxTokens = Number.isFinite(maxTokens) ? maxTokens : 2048;
        this.baseURL = baseURL;
        this.extraHeaders = extraHeaders;

        if (!this.apiKey) {
            throw new Error(missingKeyMessage || `${providerLabel} API key is not configured.`);
        }

        if (!this.modelId) {
            throw new Error(missingModelMessage || `No ${providerLabel} model selected.`);
        }
    }

    async sendMessage(messages, onChunk, tools = undefined, onToolCall = null) {
        try {
            const apiMessages = messages.map((m) => {
                if (m.role === "tool") {
                    return {
                        role: "tool",
                        tool_call_id: m.toolCallId || m.tool_call_id,
                        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                    };
                }

                if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
                    return {
                        role: "assistant",
                        content: m.content || null,
                        tool_calls: m.toolCalls.map((tc) => ({
                            id: tc.id,
                            type: "function",
                            function: {
                                name: tc.name,
                                arguments: JSON.stringify(tc.input || tc.arguments || {}),
                            },
                        })),
                    };
                }

                return {
                    role: m.role,
                    content: m.content,
                };
            });

            const requestBody = {
                model: this.modelId,
                messages: apiMessages,
                stream: true,
                max_tokens: this.maxTokens,
            };

            if (tools && Object.keys(tools).length > 0) {
                const toolDefs = [];
                for (const [name, toolDef] of Object.entries(tools)) {
                    let parameters = {};
                    if (toolDef.parameters) {
                        if (typeof toolDef.parameters.jsonSchema === "object") {
                            parameters = toolDef.parameters.jsonSchema;
                        } else if (typeof toolDef.parameters.jsonSchema === "function") {
                            parameters = toolDef.parameters.jsonSchema();
                        } else if (toolDef.parameters._def) {
                            parameters = extractZodJsonSchema(toolDef.parameters);
                        } else {
                            parameters = toolDef.parameters;
                        }
                    }

                    toolDefs.push({
                        type: "function",
                        function: {
                            name,
                            description: toolDef.description || "",
                            parameters,
                        },
                    });
                }
                requestBody.tools = toolDefs;
            }

            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    ...this.extraHeaders,
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                let errorMsg = response.statusText;
                try {
                    const errorDetail = await response.json();
                    errorMsg = errorDetail.error?.message || JSON.stringify(errorDetail);
                } catch {
                    // ignore parse error
                }
                throw new Error(`${this.providerLabel} API error ${response.status}: ${errorMsg}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullResponse = "";
            let buffer = "";
            let finishReason = "stop";
            const toolCallAccumulator = {};

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.trim() === "data: [DONE]") continue;
                    if (!line.startsWith("data: ")) continue;

                    const dataStr = line.substring(6).trim();
                    if (!dataStr) continue;

                    try {
                        const data = JSON.parse(dataStr);
                        const choice = data.choices?.[0];
                        if (!choice) continue;

                        const delta = choice.delta || {};
                        if (choice.finish_reason) {
                            finishReason = choice.finish_reason;
                        }

                        if (delta.content) {
                            fullResponse += delta.content;
                            if (onChunk) onChunk(delta.content);
                        }

                        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index ?? 0;
                                if (!toolCallAccumulator[idx]) {
                                    toolCallAccumulator[idx] = { id: "", name: "", arguments: "" };
                                }

                                const acc = toolCallAccumulator[idx];
                                if (tc.id) acc.id = tc.id;
                                if (tc.function?.name) acc.name += tc.function.name;
                                if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                            }
                        }
                    } catch {
                        // skip malformed SSE lines
                    }
                }
            }

            const toolCalls = [];
            const sortedIndices = Object.keys(toolCallAccumulator).sort((a, b) => a - b);

            for (const idx of sortedIndices) {
                const acc = toolCallAccumulator[idx];
                let parsedArgs = {};

                try {
                    parsedArgs = acc.arguments ? JSON.parse(acc.arguments) : {};
                } catch (e) {
                    console.error(chalk.yellow(`Warning: Failed to parse tool call arguments for "${acc.name}": ${e.message}`));
                    parsedArgs = { _raw: acc.arguments };
                }

                const toolCall = {
                    id: acc.id || `call_${Date.now()}_${idx}`,
                    name: acc.name,
                    input: parsedArgs,
                    args: parsedArgs,
                    toolName: acc.name,
                };

                toolCalls.push(toolCall);
                if (onToolCall) onToolCall(toolCall);
            }

            return {
                content: fullResponse,
                finishReason,
                usage: {},
                toolCalls,
                toolResults: [],
                steps: [],
            };
        } catch (error) {
            console.error(chalk.red(`\n${this.providerLabel} Provider Error:`), error.message);
            throw error;
        }
    }

    async getMessage(messages, tools = undefined) {
        const result = await this.sendMessage(messages, null, tools);
        return result.content;
    }

    async generateStructured() {
        throw new Error(`generateStructured is not supported via ${this.providerLabel} directly. Use Gemini provider for structured output.`);
    }
}
