export interface ModelFimConfig {
    fimPrefix: string;
    fimSuffix: string;
    fimMiddle: string;
    /** Stop tokens that signal end-of-generation for this model family */
    stopTokens: string[];
}

/**
 * Lookup FIM config by model name string.
 * Order matters: more specific matches (e.g. 'starcoder') are checked
 * before broader ones (e.g. 'qwen') to avoid false positives.
 */
export function getModelFimConfig(modelName: string): ModelFimConfig {
    const name = modelName.toLowerCase();

    if (name.includes('starcoder')) {
        return {
            fimPrefix: '<fim_prefix>',
            fimSuffix: '<fim_suffix>',
            fimMiddle: '<fim_middle>',
            stopTokens: [
                '<fim_prefix>', '<fim_suffix>', '<fim_middle>',
                '<|endoftext|>', '<file_sep>',
                '```',
            ],
        };
    }

    if (name.includes('deepseek')) {
        return {
            fimPrefix: '<\uFF5Cfim\u2581begin\uFF5C>',
            fimSuffix: '<\uFF5Cfim\u2581hole\uFF5C>',
            fimMiddle: '<\uFF5Cfim\u2581end\uFF5C>',
            stopTokens: [
                '<\uFF5Cfim\u2581begin\uFF5C>', '<\uFF5Cfim\u2581hole\uFF5C>', '<\uFF5Cfim\u2581end\uFF5C>',
                '<\uFF5Cend\u2581of\u2581sentence\uFF5C>',
                '<|endoftext|>', '<|eos|>',
                '<think>',
                '```',
            ],
        };
    }

    if (name.includes('qwen')) {
        return {
            fimPrefix: '<|fim_prefix|>',
            fimSuffix: '<|fim_suffix|>',
            fimMiddle: '<|fim_middle|>',
            stopTokens: [
                '<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>',
                '<|endoftext|>', '<|im_end|>', '<|im_start|>',
                '<|fim_pad|>', '<|file_sep|>',
                '<think>',
                '```',
            ],
        };
    }

    if (name.includes('codegemma') || name.includes('code-gemma')) {
        return {
            fimPrefix: '<|fim_prefix|>',
            fimSuffix: '<|fim_suffix|>',
            fimMiddle: '<|fim_middle|>',
            stopTokens: [
                '<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>',
                '<|file_separator|>', '<|endoftext|>',
                '```',
            ],
        };
    }

    // Default: CodeLlama-style
    return {
        fimPrefix: '<PRE> ',
        fimSuffix: ' <SUF> ',
        fimMiddle: ' <MID>',
        stopTokens: [
            '<PRE>', '<SUF>', '<MID>',
            '</s>', '<EOT>',
            '<|endoftext|>',
            '```',
        ],
    };
}

/**
 * Detect whether a model is FIM-capable (trained on Fill-in-the-Middle tokens).
 * Non-FIM models (general instruct/reasoning) need the chat API fallback instead.
 */
export function isFimCapable(modelName: string): boolean {
    const name = modelName.toLowerCase();

    const fimPatterns = [
        'starcoder',
        'codellama', 'code-llama',
        'codegemma', 'code-gemma',
        'codestral',
        'deepseek-coder', 'deepseek-v2',
    ];

    for (const pattern of fimPatterns) {
        if (name.includes(pattern)) {
            return true;
        }
    }

    // Generic "coder" catches qwen2.5-coder, yi-coder, etc.
    if (name.includes('coder')) {
        return true;
    }

    return false;
}

/**
 * Detect thinking/reasoning models that support the `think` parameter.
 * Used to send `think: false` in chat mode to suppress reasoning overhead.
 */
export function isThinkingModel(modelName: string): boolean {
    const name = modelName.toLowerCase();
    return name.includes('qwen3') ||
           name.includes('deepseek-r1') ||
           name.includes('qwq') ||
           name.includes('glm');
}
