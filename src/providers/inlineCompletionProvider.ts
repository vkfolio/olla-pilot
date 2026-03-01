import * as vscode from 'vscode';
import { OllamaService } from '../services/ollamaService';
import { postProcess } from '../utils/postProcess';

export class OllamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private ollamaService: OllamaService;
    private debounceTimer: NodeJS.Timeout | null = null;
    private currentModel: string;
    private isEnabled: boolean;
    private currentAbortController: AbortController | null = null;
    private completionCache: Map<string, { text: string; timestamp: number }> = new Map();

    private static readonly CACHE_TTL_MS = 30_000;
    private static readonly CACHE_MAX_SIZE = 50;

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

    private get debounceMs(): number {
        return vscode.workspace.getConfiguration('ollapilot').get<number>('debounceMs', 300);
    }

    private isInCommentContext(document: vscode.TextDocument, position: vscode.Position): boolean {
        const line = document.lineAt(position.line).text;
        const textBeforeCursor = line.substring(0, position.character).trimStart();

        const singleLineCommentPrefixes = ['///', '//', '##', '#', '--', '%', ';'];
        for (const prefix of singleLineCommentPrefixes) {
            if (textBeforeCursor.startsWith(prefix)) {
                return true;
            }
        }

        if (textBeforeCursor.startsWith('*')) {
            return true;
        }

        const scanStart = Math.max(0, position.line - 30);
        const textUpToCursor = document.getText(
            new vscode.Range(new vscode.Position(scanStart, 0), position)
        );
        const lastBlockOpen = textUpToCursor.lastIndexOf('/*');
        const lastBlockClose = textUpToCursor.lastIndexOf('*/');
        if (lastBlockOpen > lastBlockClose) {
            return true;
        }

        const tripleDoubleCount = (textUpToCursor.match(/"""/g) || []).length;
        const tripleSingleCount = (textUpToCursor.match(/'''/g) || []).length;
        if (tripleDoubleCount % 2 === 1 || tripleSingleCount % 2 === 1) {
            return true;
        }

        return false;
    }

    private truncateToLinesBefore(text: string, maxChars: number): string {
        if (text.length <= maxChars) { return text; }
        const cutPoint = text.length - maxChars;
        const nextNewline = text.indexOf('\n', cutPoint);
        if (nextNewline === -1) { return text; }
        return text.substring(nextNewline + 1);
    }

    private truncateToLinesAfter(text: string, maxChars: number): string {
        if (text.length <= maxChars) { return text; }
        const lastNewline = text.lastIndexOf('\n', maxChars);
        if (lastNewline === -1) { return text.substring(0, maxChars); }
        return text.substring(0, lastNewline);
    }

    private getCacheKey(prefix: string, suffix: string, model: string): string {
        return `${model}::${prefix.slice(-200)}::${suffix.slice(0, 100)}`;
    }

    private getCachedCompletion(key: string): string | null {
        const entry = this.completionCache.get(key);
        if (!entry) { return null; }
        if (Date.now() - entry.timestamp > OllamaInlineCompletionProvider.CACHE_TTL_MS) {
            this.completionCache.delete(key);
            return null;
        }
        return entry.text;
    }

    private setCachedCompletion(key: string, text: string): void {
        if (this.completionCache.size >= OllamaInlineCompletionProvider.CACHE_MAX_SIZE) {
            const firstKey = this.completionCache.keys().next().value;
            if (firstKey !== undefined) {
                this.completionCache.delete(firstKey);
            }
        }
        this.completionCache.set(key, { text, timestamp: Date.now() });
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {

        if (!this.isEnabled || !this.currentModel) { return null; }

        const prefixRange = new vscode.Range(new vscode.Position(0, 0), position);
        const prefix = document.getText(prefixRange);
        const suffixRange = new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end);
        const suffix = document.getText(suffixRange);

        const MAX_CONTEXT = 2000;
        const truncatedPrefix = this.truncateToLinesBefore(prefix, MAX_CONTEXT);
        const truncatedSuffix = this.truncateToLinesAfter(suffix, MAX_CONTEXT);

        const isCommentContext = this.isInCommentContext(document, position);

        const currentLine = document.lineAt(position.line).text;
        const afterCursor = currentLine.substring(position.character).trim();
        const isMidLine = afterCursor.length > 0;

        const singleLineMode = isCommentContext || isMidLine;

        const cacheKey = this.getCacheKey(truncatedPrefix, truncatedSuffix, this.currentModel);
        const cached = this.getCachedCompletion(cacheKey);
        if (cached) {
            return [{ insertText: cached, range: new vscode.Range(position, position) }];
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }

        await new Promise<void>((resolve) => {
            this.debounceTimer = setTimeout(() => resolve(), this.debounceMs);
            token.onCancellationRequested(() => resolve());
        });

        if (token.isCancellationRequested) { return null; }

        const abortController = new AbortController();
        this.currentAbortController = abortController;

        const cancellationListener = token.onCancellationRequested(() => {
            abortController.abort();
        });

        try {
            vscode.window.setStatusBarMessage('$(sync~spin) Ollama thinking...', 3000);

            console.log(`[OllaPilot] Sending request to Ollama with model: ${this.currentModel}`);
            const completion = await this.ollamaService.generateCompletion(
                this.currentModel,
                truncatedPrefix,
                truncatedSuffix,
                document.languageId,
                document.fileName,
                singleLineMode,
                abortController.signal
            );

            if (token.isCancellationRequested || !completion) { return null; }

            console.log(`[OllaPilot] Received completion: ${completion}`);

            const cleaned = postProcess(completion, truncatedPrefix, truncatedSuffix, isCommentContext);
            if (!cleaned) { return null; }

            this.setCachedCompletion(cacheKey, cleaned);

            return [{
                insertText: cleaned,
                range: new vscode.Range(position, position)
            }];
        } catch (err) {
            console.error('[OllaPilot] Completion error:', err);
            return null;
        } finally {
            cancellationListener.dispose();
            if (this.currentAbortController === abortController) {
                this.currentAbortController = null;
            }
        }
    }
}
