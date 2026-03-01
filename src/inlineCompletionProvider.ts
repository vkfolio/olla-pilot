import * as vscode from 'vscode';
import { OllamaService } from './ollamaService';

export class OllamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private ollamaService: OllamaService;
    private debounceTimer: NodeJS.Timeout | null = null;
    private currentModel: string;
    private isEnabled: boolean;

    constructor(ollamaService: OllamaService, initialModel: string, isEnabled: boolean) {
        this.ollamaService = ollamaService;
        this.currentModel = initialModel;
        this.isEnabled = isEnabled;
    }

    public setModel(model: string) {
        this.currentModel = model;
    }

    public setEnabled(enabled: boolean) {
        this.isEnabled = enabled;
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {

        if (!this.isEnabled || !this.currentModel) {
            return null;
        }

        // Get prefix (text before cursor) and suffix (text after cursor)
        const prefixRange = new vscode.Range(new vscode.Position(0, 0), position);
        const prefix = document.getText(prefixRange);

        const suffixRange = new vscode.Range(
            position,
            document.lineAt(document.lineCount - 1).range.end
        );
        const suffix = document.getText(suffixRange);

        // Keep local context small to avoid huge payloads and slow generation
        // E.g., last 1000 chars of prefix and first 1000 chars of suffix
        const MAX_CONTEXT = 2000;
        const truncatedPrefix = prefix.slice(-MAX_CONTEXT);
        const truncatedSuffix = suffix.slice(0, MAX_CONTEXT);

        // Debounce requests to avoid overwhelming the local model while typing fast
        return new Promise((resolve) => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve(null);
                    return;
                }

                try {
                    // Show some visual indication we are working on it (optional)
                    vscode.window.setStatusBarMessage('$(sync~spin) Ollama thinking...', 2000);

                    const completion = await this.ollamaService.generateCompletion(
                        this.currentModel,
                        '', // FIM prompt uses prefix/suffix
                        truncatedPrefix,
                        truncatedSuffix
                    );

                    if (token.isCancellationRequested || !completion) {
                        resolve(null);
                        return;
                    }

                    const items: vscode.InlineCompletionItem[] = [{
                        insertText: completion,
                        range: new vscode.Range(position, position)
                    }];

                    resolve(items);
                } catch (err) {
                    console.error('Completion error:', err);
                    resolve(null);
                }
            }, 500); // 500ms debounce
        });
    }
}
