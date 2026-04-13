import { google } from '@ai-sdk/google';
import { debug } from '../lib/debug.js';
import { readFileTool, editFileTool } from '../cli/lib/fs-tools.js';

/**
 * Available Google Generative AI tools configuration
 * Tools are instantiated lazily to avoid initialization errors
 */
export const availableTools = [
    {
        id: 'google_search',
        name: 'Google Search',
        description: 'Access the latest information using Google search. Useful for current events, news, and real-time information.',
        getTool: () => google.tools.googleSearch({}),
        enabled: false,
    },
    {
        id: 'code_execution',
        name: 'Code Execution',
        description: 'Generate and execute Python code to perform calculations, solve problems, or provide accurate information.',
        getTool: () => google.tools.codeExecution({}),
        enabled: false,
    },
    {
        id: 'url_context',
        name: 'URL Context',
        description: 'Provide specific URLs that you want the model to analyze directly from the prompt. Supports up to 20 URLs per request.',
        getTool: () => google.tools.urlContext({}),
        enabled: false,
    },
    readFileTool,
    editFileTool
];

/**
 * Get enabled tools as a tools object for AI SDK
 */
export function getEnabledTools() {
    const tools = {};

    try {
        for (const toolConfig of availableTools) {
            if (toolConfig.enabled) {
                // Instantiate the tool when needed
                tools[toolConfig.id] = toolConfig.getTool();
            }
        }

        // Debug logging
        if (Object.keys(tools).length > 0) {
            debug(`Enabled tools: ${Object.keys(tools).join(', ')}`);
        } else {
            debug('No tools enabled');
        }

        return Object.keys(tools).length > 0 ? tools : undefined;
    } catch (error) {
        console.error(chalk.red('[ERROR] Failed to initialize tools:'), error.message);
        return undefined;
    }
}

/**
 * Toggle a tool's enabled state
 */
export function toggleTool(toolId) {
    const tool = availableTools.find(t => t.id === toolId);
    if (tool) {
        tool.enabled = !tool.enabled;
        debug(`Tool ${toolId} toggled to ${tool.enabled}`);
        return tool.enabled;
    }
    debug(`Tool ${toolId} not found`);
    return false;
}

/**
 * Enable specific tools
 */
export function enableTools(toolIds) {
    debug('enableTools called with:', toolIds);

    availableTools.forEach(tool => {
        const wasEnabled = tool.enabled;
        tool.enabled = toolIds.includes(tool.id);

        if (tool.enabled !== wasEnabled) {
            debug(`${tool.id}: ${wasEnabled} → ${tool.enabled}`);
        }
    });

    const enabledCount = availableTools.filter(t => t.enabled).length;
    debug(`Total tools enabled: ${enabledCount}/${availableTools.length}`);
}

/**
 * Get all enabled tool names
 */
export function getEnabledToolNames() {
    const names = availableTools.filter(t => t.enabled).map(t => t.name);
    debug('getEnabledToolNames returning:', names);
    return names;
}

/**
 * Reset all tools (disable all)
 */
export function resetTools() {
    availableTools.forEach(tool => {
        tool.enabled = false;
    });
    debug('All tools have been reset (disabled)');
}