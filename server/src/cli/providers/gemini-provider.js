import { google } from "@ai-sdk/google";
import { streamText, generateObject, stepCountIs } from "ai";
import { config } from "../../config/google.config.js";
import { debug } from "../../lib/debug.js";
import { BaseProvider } from "./base-provider.js";
import chalk from "chalk";
import { configManager } from "../config/config-manager.js";

/**
 * Convert messages from the agent loop's loose shape into the canonical
 * AI SDK v5 ModelMessage format. The agent loop pushes:
 *   - { role: 'assistant', content: 'text'|null, toolCalls: [...] }
 *   - { role: 'tool', toolCallId, toolName, content: 'string' }
 * Both shapes are illegal for streamText in v5, which expects content parts.
 */
function toModelMessages(messages) {
    return messages.map((m) => {
        if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
            const parts = [];
            if (m.content && typeof m.content === "string" && m.content.trim().length > 0) {
                parts.push({ type: "text", text: m.content });
            }
            for (const tc of m.toolCalls) {
                parts.push({
                    type: "tool-call",
                    toolCallId: tc.id || tc.toolCallId,
                    toolName: tc.name || tc.toolName,
                    input: tc.input ?? tc.args ?? {},
                });
            }
            return { role: "assistant", content: parts };
        }

        if (m.role === "tool") {
            const rawContent = typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content ?? "");
            return {
                role: "tool",
                content: [
                    {
                        type: "tool-result",
                        toolCallId: m.toolCallId || m.tool_call_id,
                        toolName: m.toolName || "unknown_tool",
                        output: { type: "text", value: rawContent },
                    },
                ],
            };
        }

        if (typeof m.content !== "string") {
            return { role: m.role, content: JSON.stringify(m.content ?? "") };
        }
        return { role: m.role, content: m.content };
    });
}

export class GeminiProvider extends BaseProvider {
    constructor() {
        super();
        if (!config.googleApiKey) {
            throw new Error("GOOGLE_API_KEY is not set in environment variables. Check your config.");
        }

        const modelId = configManager.getSelectedModel('gemini') || config.model;

        this.model = google(modelId, {
            apiKey: config.googleApiKey,
        });
    }

    async sendMessage(messages, onChunk, tools = undefined, onToolCall = null) {
        try {
            const streamConfig = {
                model: this.model,
                messages: toModelMessages(messages),
            };

            if (tools && Object.keys(tools).length > 0) {
                streamConfig.tools = tools;
                // The agent loop drives multi-turn tool calling. We let the SDK
                // perform a single step (LLM call + auto-execute tools) per
                // sendMessage call. Default stopWhen is stepCountIs(1), but we
                // make it explicit for clarity.
                streamConfig.stopWhen = stepCountIs(1);

                debug(`Tools enabled: ${Object.keys(tools).join(', ')}`);
            }

            const result = streamText(streamConfig);
            let fullResponse = "";

            for await (const chunk of result.textStream) {
                fullResponse += chunk;
                if (onChunk) {
                    onChunk(chunk);
                }
            }

            // In AI SDK v5, all of these are Promises that must be awaited.
            const [stepsRaw, finishReason, usage, toolCallsRaw, toolResultsRaw] = await Promise.all([
                result.steps,
                result.finishReason,
                result.usage,
                result.toolCalls,
                result.toolResults,
            ]);

            const toolCalls = (toolCallsRaw || []).map((tc) => ({
                id: tc.toolCallId,
                name: tc.toolName,
                toolName: tc.toolName,
                input: tc.input,
                args: tc.input,
            }));

            if (onToolCall) {
                for (const tc of toolCalls) onToolCall(tc);
            }

            const toolResults = (toolResultsRaw || []).map((tr) => {
                const output = tr.output;
                let resultValue = output;
                if (output && typeof output === "object" && "value" in output) {
                    resultValue = output.value;
                }
                return {
                    toolCallId: tr.toolCallId,
                    toolName: tr.toolName,
                    output,
                    result: resultValue,
                };
            });

            return {
                content: fullResponse,
                finishReason,
                usage,
                toolCalls,
                toolResults,
                steps: stepsRaw || [],
            };
        } catch (error) {
            console.error(chalk.red(`\nAI Service Error:`), error.message);
            debug('Full error:', error);
            throw error;
        }
    }

    async getMessage(messages, tools = undefined) {
        let fullResponse = "";
        const result = await this.sendMessage(messages, (chunk) => {
            fullResponse += chunk;
        }, tools);
        return result.content;
    }

    async generateStructured(schema, prompt) {
        try {
            const result = await generateObject({
                model: this.model,
                schema: schema,
                prompt: prompt,
            });

            return result.object;
        } catch (error) {
            console.error(chalk.red("AI Structured Generation Error:"), error.message);
            throw error;
        }
    }
}
