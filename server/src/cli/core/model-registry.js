export const MODEL_PROVIDERS = {
    GEMINI: 'gemini',
    OPENROUTER: 'openrouter'
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
