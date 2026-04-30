import { BaseProvider } from "./base-provider.js";
import { configManager } from "../config/config-manager.js";
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
        // If the schema has a _def with typeName, we can extract basic info
        const def = zodSchema._def;
        if (!def) return {};

        if (def.typeName === 'ZodObject' && def.shape) {
            const properties = {};
            const required = [];
            const shape = typeof def.shape === 'function' ? def.shape() : def.shape;

            for (const [key, value] of Object.entries(shape)) {
                const propDef = value._def || {};
                let propSchema = { type: 'string' };

                if (propDef.typeName === 'ZodString') {
                    propSchema = { type: 'string' };
                } else if (propDef.typeName === 'ZodNumber') {
                    propSchema = { type: 'number' };
                } else if (propDef.typeName === 'ZodBoolean') {
                    propSchema = { type: 'boolean' };
                } else if (propDef.typeName === 'ZodArray') {
                    propSchema = { type: 'array', items: { type: 'string' } };
                } else if (propDef.typeName === 'ZodOptional') {
                    // Unwrap optional
                    propSchema = { type: 'string' };
                } else if (propDef.typeName === 'ZodDefault') {
                    propSchema = { type: 'string' };
                }

                // Add description if available
                if (propDef.description) {
                    propSchema.description = propDef.description;
                }

                properties[key] = propSchema;

                // If not optional/default, mark as required
                if (propDef.typeName !== 'ZodOptional' && propDef.typeName !== 'ZodDefault') {
                    required.push(key);
                }
            }

            return {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
            };
        }
    } catch {
        // Fall through to empty schema
    }
    return {};
}


/**
 * OpenRouter AI provider.
 * Connects to the OpenRouter API (OpenAI-compatible) with full support for:
 * - Streaming text responses via SSE
 * - Streaming tool/function calls (accumulated across SSE chunks)
 */
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

    /**
     * Send a message to the OpenRouter API with streaming support.
     * Properly accumulates tool call chunks across SSE events.
     *
     * @param {Array} messages - Array of message objects { role, content }
     * @param {Function|null} onChunk - Callback invoked for each text chunk
     * @param {Object|undefined} tools - Map of tool definitions (AI SDK format)
     * @param {Function|null} onToolCall - Callback invoked for each completed tool call
     * @returns {Promise<Object>} { content, finishReason, usage, toolCalls, toolResults, steps }
     */
    async sendMessage(messages, onChunk, tools = undefined, onToolCall = null) {
        try {
            // Map internal messages to OpenAI API format
            const apiMessages = messages.map(m => {
                // Handle tool result messages
                if (m.role === 'tool') {
                    return {
                        role: 'tool',
                        tool_call_id: m.toolCallId || m.tool_call_id,
                        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                    };
                }
                // Handle assistant messages that include tool_calls
                if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
                    return {
                        role: 'assistant',
                        content: m.content || null,
                        tool_calls: m.toolCalls.map(tc => ({
                            id: tc.id,
                            type: 'function',
                            function: {
                                name: tc.name,
                                arguments: JSON.stringify(tc.input || tc.arguments || {}),
                            }
                        })),
                    };
                }
                return {
                    role: m.role,
                    content: m.content,
                };
            });

            // Build request body
            const requestBody = {
                model: this.modelId,
                messages: apiMessages,
                stream: true,
            };

            // Convert AI SDK tool definitions to OpenAI function-calling format.
            // AI SDK tools created with tool() have a .parameters property that is
            // a Zod schema. We need to convert it to a JSON Schema object for the
            // OpenAI-compatible API.
            if (tools && Object.keys(tools).length > 0) {
                const toolDefs = [];
                for (const [name, toolDef] of Object.entries(tools)) {
                    let parameters = {};
                    if (toolDef.parameters) {
                        if (typeof toolDef.parameters.jsonSchema === 'object') {
                            // AI SDK v4+ exposes .jsonSchema as an object
                            parameters = toolDef.parameters.jsonSchema;
                        } else if (typeof toolDef.parameters.jsonSchema === 'function') {
                            // Some versions expose it as a function
                            parameters = toolDef.parameters.jsonSchema();
                        } else if (toolDef.parameters._def) {
                            // Raw Zod schema — extract a minimal JSON Schema manually
                            parameters = extractZodJsonSchema(toolDef.parameters);
                        } else {
                            parameters = toolDef.parameters;
                        }
                    }

                    toolDefs.push({
                        type: "function",
                        function: {
                            name,
                            description: toolDef.description || '',
                            parameters,
                        }
                    });
                }
                requestBody.tools = toolDefs;
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
            let finishReason = "stop";

            // ── Tool call accumulator ──────────────────────────────────────
            // OpenRouter (OpenAI-compatible) streams tool_calls in chunks:
            //   delta.tool_calls: [{ index, id?, function: { name?, arguments? } }]
            // We accumulate them by index across multiple SSE events.
            const toolCallAccumulator = {};  // index → { id, name, arguments }

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                // Keep the last potentially-incomplete line in the buffer
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.trim() === "data: [DONE]") continue;
                    
                    if (line.startsWith("data: ")) {
                        const dataStr = line.substring(6).trim();
                        if (!dataStr) continue;

                        try {
                            const data = JSON.parse(dataStr);
                            const choice = data.choices?.[0];
                            if (!choice) continue;

                            const delta = choice.delta || {};

                            // Capture finish_reason
                            if (choice.finish_reason) {
                                finishReason = choice.finish_reason;
                            }

                            // ── Accumulate text content ──
                            if (delta.content) {
                                fullResponse += delta.content;
                                if (onChunk) {
                                    onChunk(delta.content);
                                }
                            }

                            // ── Accumulate tool calls ──
                            if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                                for (const tc of delta.tool_calls) {
                                    const idx = tc.index ?? 0;

                                    if (!toolCallAccumulator[idx]) {
                                        toolCallAccumulator[idx] = {
                                            id: '',
                                            name: '',
                                            arguments: '',
                                        };
                                    }

                                    const acc = toolCallAccumulator[idx];

                                    if (tc.id) {
                                        acc.id = tc.id;
                                    }
                                    if (tc.function?.name) {
                                        acc.name += tc.function.name;
                                    }
                                    if (tc.function?.arguments) {
                                        acc.arguments += tc.function.arguments;
                                    }
                                }
                            }
                        } catch (e) {
                            // Skip malformed SSE lines silently
                        }
                    }
                }
            }

            // ── Parse completed tool calls ──────────────────────────────────
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
                    // Also store in 'args' for compatibility with Gemini format
                    args: parsedArgs,
                    toolName: acc.name,
                };

                toolCalls.push(toolCall);

                if (onToolCall) {
                    onToolCall(toolCall);
                }
            }

            return {
                content: fullResponse,
                finishReason,
                usage: {},
                toolCalls,
                toolResults: [],
                steps: []
            };

        } catch (error) {
            console.error(chalk.red(`\nOpenRouter Provider Error:`), error.message);
            throw error;
        }
    }

    /**
     * Get a complete (non-streaming) response.
     * @param {Array} messages - Message array
     * @param {Object} tools - Optional tools
     * @returns {Promise<string>} Full response text
     */
    async getMessage(messages, tools = undefined) {
        const result = await this.sendMessage(messages, null, tools);
        return result.content;
    }

    /**
     * Structured output generation is not natively supported via OpenRouter.
     * @throws {Error} Always throws — use Gemini provider for structured output.
     */
    async generateStructured(schema, prompt) {
        throw new Error("generateStructured is not supported via OpenRouter directly. Use Gemini provider for structured output.");
    }
}
