/**
 * Parse JSON from model output (markdown fences or brace slice).
 */
export function extractJson(text) {
    if (typeof text !== "string") {
        throw new Error("extractJson expected string");
    }
    try {
        const match = text.match(/```json\n([\s\S]*?)\n```/);
        if (match) return JSON.parse(match[1]);

        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
            return JSON.parse(text.slice(firstBrace, lastBrace + 1));
        }

        return JSON.parse(text);
    } catch {
        throw new Error("Failed to parse JSON response from AI");
    }
}

export function cleanMarkdown(text) {
    if (!text) return "";
    let cleaned = text.trim();
    const match = cleaned.match(/^```[\w]*\n([\s\S]*?)```$/);
    if (match) return match[1].trim();
    return cleaned;
}
