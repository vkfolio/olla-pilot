import * as vscode from 'vscode';
import { getModelFimConfig, isFimCapable, isThinkingModel } from '../config/modelConfig';

export interface OllamaModel {
    name: string;
}

export class OllamaService {
    private get url(): string {
        const config = vscode.workspace.getConfiguration('ollapilot');
        let baseUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }
        return baseUrl;
    }

    public async getModels(): Promise<OllamaModel[]> {
        try {
            const response = await fetch(`${this.url}/api/tags`);
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }
            const data = await response.json() as any;
            return data.models || [];
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            return [];
        }
    }

    /**
     * Chat-mode completion for instruct/general models that don't understand FIM tokens.
     */
    private async generateChatCompletion(
        model: string,
        prefix: string,
        suffix: string,
        languageId: string,
        fileName: string,
        singleLineMode: boolean,
        signal?: AbortSignal
    ): Promise<string | null> {
        const isProseFile = ['markdown', 'plaintext', 'latex', 'restructuredtext', 'asciidoc', 'txt', 'mdx'].includes(languageId);

        const systemPrompt = isProseFile
            ? 'You are a text completion engine. You will be given text with a <CURSOR> marker showing where the user\'s cursor is. ' +
              'Continue writing naturally from <CURSOR>, following the topic, tone, and style of the surrounding text. ' +
              'Output ONLY the text that should be inserted at <CURSOR>. ' +
              'Do NOT repeat any text that already exists before or after <CURSOR>. ' +
              'Do NOT include any explanation or the <CURSOR> marker in your output. ' +
              'Output the continuation only.'
            : 'You are a code completion engine. You will be given code with a <CURSOR> marker showing where the user\'s cursor is. ' +
              'Output ONLY the raw code that should be inserted at <CURSOR>. ' +
              'Do NOT repeat any code that already exists before or after <CURSOR>. ' +
              'Do NOT include any explanation, markdown formatting, or code fences. ' +
              'Do NOT include the <CURSOR> marker in your output. ' +
              'Output raw code only.';

        const userPrompt = isProseFile
            ? `File: ${fileName}\n` +
              `Continue writing at <CURSOR>:\n\n` +
              `${prefix}<CURSOR>${suffix}`
            : `File: ${fileName} (${languageId})\n` +
              `Complete the code at <CURSOR>:\n\n` +
              `${prefix}<CURSOR>${suffix}`;

        const stopTokens: string[] = ['```'];
        if (singleLineMode) {
            stopTokens.push('\n');
        }

        const requestBody: any = {
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            stream: false,
            options: {
                temperature: 0.1,
                num_predict: singleLineMode ? 60 : 128,
                top_k: 30,
                top_p: 0.9,
                repeat_penalty: 1.1,
                stop: stopTokens,
            }
        };

        if (isThinkingModel(model)) {
            requestBody.think = false;
        }

        const response = await fetch(`${this.url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: signal,
        });

        console.log(`[OllaPilot] Chat API Response Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[OllaPilot] Chat API Error body: ${errorText}`);
            throw new Error(`Ollama Chat API error: ${response.statusText}`);
        }

        const data = await response.json() as any;

        if (data?.message?.content && typeof data.message.content === 'string' && data.message.content.trim() !== '') {
            return data.message.content.trimEnd();
        }

        console.log('[OllaPilot] Chat API returned empty response, discarding.');
        return null;
    }

    public async generateCompletion(
        model: string,
        prefix: string,
        suffix: string,
        languageId: string,
        fileName: string,
        singleLineMode: boolean,
        signal?: AbortSignal
    ): Promise<string | null> {
        try {
            if (!isFimCapable(model)) {
                console.log(`[OllaPilot] Model "${model}" is not FIM-capable, using chat mode`);
                return await this.generateChatCompletion(
                    model, prefix, suffix, languageId, fileName, singleLineMode, signal
                );
            }

            const fimConfig = getModelFimConfig(model);
            const fullPrompt = `${fimConfig.fimPrefix}${prefix}${fimConfig.fimSuffix}${suffix}${fimConfig.fimMiddle}`;

            const stopTokens = [...fimConfig.stopTokens];
            if (singleLineMode) {
                stopTokens.push('\n');
            }

            const requestBody = {
                model: model,
                prompt: fullPrompt,
                stream: false,
                raw: true,
                options: {
                    temperature: 0.1,
                    num_predict: singleLineMode ? 60 : 128,
                    top_k: 30,
                    top_p: 0.9,
                    repeat_penalty: 1.1,
                    stop: stopTokens,
                }
            };

            const response = await fetch(`${this.url}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: signal,
            });

            console.log(`[OllaPilot] FIM API Response Status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[OllaPilot] FIM API Error body: ${errorText}`);
                throw new Error(`Ollama API error: ${response.statusText}`);
            }

            const data = await response.json() as any;

            if (data && typeof data.response === 'string' && data.response.trim() !== '') {
                return data.response.trimEnd();
            }

            console.log('[OllaPilot] FIM API returned empty or thinking-only response, discarding.',
                data?.thinking ? '(thinking block was present but discarded)' : '');
            return null;

        } catch (error: any) {
            if (error?.name === 'AbortError') {
                console.log('[OllaPilot] Request was aborted.');
                return null;
            }
            console.error('[OllaPilot] Error generating completion:', error);
            return null;
        }
    }
}

/**
 * Factory to get the configured Ollama base URL from VSCode settings.
 */
export function getOllamaBaseUrl(): string {
    const config = vscode.workspace.getConfiguration('ollapilot');
    let baseUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
    if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl.slice(0, -1);
    }
    return baseUrl;
}
