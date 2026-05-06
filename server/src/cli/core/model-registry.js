export const MODEL_PROVIDERS = {
    GEMINI: 'gemini',
    OPENROUTER: 'openrouter',
    SWIFTROUTER: 'swiftrouter'
};

export const MODELS = [
    {
        name: "Gemini 2.5 Pro",
        id: "gemini-2.5-pro",
        provider: MODEL_PROVIDERS.GEMINI
    },
    {
        name: "Qwen 3.6 Plus",
        id: "qwen/qwen3.6-plus:free",
        provider: MODEL_PROVIDERS.OPENROUTER
    },
    {
        name: "NVIDIA Nemotron 3 Super",
        id: "nvidia/nemotron-3-super-120b-a12b:free",
        provider: MODEL_PROVIDERS.OPENROUTER
    },
    {
        name: "MiniMax M2.5",
        id: "minimax/minimax-m2.5:free",
        provider: MODEL_PROVIDERS.OPENROUTER
    },
    {
        name: "GPT 5.2",
        id: "gpt-5.2",
        provider: MODEL_PROVIDERS.SWIFTROUTER
    },
    {
        name: "GLM 5.1",
        id: "glm-5.1",
        provider: MODEL_PROVIDERS.SWIFTROUTER
    }
];

export function getModelsByProvider(provider) {
    return MODELS.filter(m => m.provider === provider);
}

export function getModelById(id) {
    return MODELS.find(m => m.id === id);
}

export function getAllModels() {
    return MODELS;
}
