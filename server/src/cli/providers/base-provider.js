export class BaseProvider {
    constructor() {
        if (new.target === BaseProvider) {
            throw new TypeError("Cannot construct BaseProvider instances directly");
        }
    }

    /**
     * Send a message and get streaming response
     * @param {Array} messages - Array of message objects {role, content}
     * @param {Function} onChunk - Callback for each text chunk
     * @param {Object} tools - Optional tools object
     * @param {Function} onToolCall - Callback for tool calls
     * @returns {Promise<Object>} Full response with content, tool calls, and usage
     */
    async sendMessage(messages, onChunk, tools = undefined, onToolCall = null) {
        throw new Error("Method 'sendMessage()' must be implemented.");
    }

    /**
     * Get a non-streaming response
     * @param {Array} messages - Array of message objects
     * @param {Object} tools - Optional tools
     * @returns {Promise<string>} Response text
     */
    async getMessage(messages, tools = undefined) {
        throw new Error("Method 'getMessage()' must be implemented.");
    }

    /**
     * Generate structured output using a Zod schema
     * @param {Object} schema - Zod schema
     * @param {string} prompt - Prompt for generation
     * @returns {Promise<Object>} Parsed object matching the schema
     */
    async generateStructured(schema, prompt) {
        throw new Error("Method 'generateStructured()' must be implemented.");
    }
}
