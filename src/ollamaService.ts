import * as vscode from 'vscode';

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

    public async generateCompletion(model: string, prompt: string, prefix: string, suffix: string): Promise<string | null> {
        try {
            // A simple prompt engineering for code completion
            // The model is asked to complete the code given prefix and suffix context.
            const fullPrompt = `<PRE> ${prefix} <SUF> ${suffix} <MID>`;

            const requestBody = {
                model: model,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: 0.2, // Low temperature for code completion
                    num_predict: 128   // Limit completion length
                }
            };

            const response = await fetch(`${this.url}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`);
            }

            const data = await response.json() as any;
            if (data && data.response) {
                return data.response.trimEnd();
            }
            return null;

        } catch (error) {
            console.error('Error generating completion:', error);
            return null;
        }
    }
}
