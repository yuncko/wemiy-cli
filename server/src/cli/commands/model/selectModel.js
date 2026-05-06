import { select, password, isCancel } from "@clack/prompts";
import chalk from "chalk";
import boxen from "boxen";
import { configManager } from "../../config/config-manager.js";

const MODEL_OPTIONS = [
    { value: "gemini", label: "Gemini (Local API Key)", hint: "Uses your GOOGLE_GENERATIVE_AI_API_KEY" },
    { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B", hint: "OpenRouter" },
    { value: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3", hint: "OpenRouter" },
    { value: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash", hint: "OpenRouter" },
    { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", hint: "OpenRouter" },
    { value: "mistralai/mistral-small-3.2-24b-instruct", label: "Mistral Small 3.2", hint: "OpenRouter" },
    { value: "gpt-5.2", label: "GPT 5.2", hint: "SwiftRouter" },
    { value: "glm-5.1", label: "GLM 5.1", hint: "SwiftRouter" },
];

export async function selectModelCommand() {
    const selected = await select({
        message: "Select a model",
        options: MODEL_OPTIONS
    });

    if (isCancel(selected)) {
        process.exit(0);
    }

    // If Gemini is selected, switch provider back to gemini
    if (selected === "gemini") {
        configManager.saveConfig({
            provider: "gemini",
            swiftrouter_api_key: configManager.getConfig().swiftrouter_api_key || "",
            openrouter: configManager.getConfig().openrouter || { apiKey: "", model: "" },
            swiftrouter: configManager.getConfig().swiftrouter || { apiKey: "", model: "" },
        });

        console.log(boxen(
            `${chalk.green('✅ Switched to Gemini provider')}\nUsing your local API key`,
            {
                padding: 1,
                margin: { top: 1, bottom: 1 },
                borderStyle: "round",
                borderColor: "green"
            }
        ));
        return;
    }

    const isSwiftRouterModel = ["gpt-5.2", "glm-5.1"].includes(selected);
    const providerName = isSwiftRouterModel ? "swiftrouter" : "openrouter";

    let apiKey = isSwiftRouterModel
        ? configManager.getConfig().swiftrouter?.apiKey
        : configManager.getConfig().openrouter?.apiKey;

    if (!apiKey) {
        const keyInput = await password({
            message: isSwiftRouterModel ? "Enter your SwiftRouter API key" : "Enter your OpenRouter API key",
            mask: "*",
            validate: (value) => {
                if (!value) return "API key is required";
            }
        });

        if (isCancel(keyInput)) {
            process.exit(0);
        }
        apiKey = keyInput;
    }

    const current = configManager.getConfig();
    configManager.saveConfig({
        provider: providerName,
        swiftrouter_api_key: isSwiftRouterModel
            ? apiKey
            : (current.swiftrouter_api_key || current.swiftrouter?.apiKey || ""),
        openrouter: isSwiftRouterModel
            ? (current.openrouter || { apiKey: "", model: "" })
            : { apiKey, model: selected },
        swiftrouter: isSwiftRouterModel
            ? { apiKey, model: selected }
            : (current.swiftrouter || { apiKey: "", model: "" }),
    });

    const selectedOption = MODEL_OPTIONS.find(opt => opt.value === selected);

    console.log(boxen(
        `${chalk.green('✅ Model configured successfully')}\nModel: ${chalk.bold(selectedOption.label)}`,
        {
            padding: 1,
            margin: { top: 1, bottom: 1 },
            borderStyle: "round",
            borderColor: "green"
        }
    ));
}
