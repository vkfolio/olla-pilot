import * as vscode from 'vscode';
import { OllamaService } from './services/ollamaService';
import { OllamaInlineCompletionProvider } from './providers/inlineCompletionProvider';
import { isFimCapable } from './config/modelConfig';
import { codeTaskGraph, TaskType } from './graphs/codeTaskGraph';
import { getOllamaBaseUrl } from './services/ollamaService';

let statusBarItem: vscode.StatusBarItem;
let ollamaService: OllamaService;
let completionProvider: OllamaInlineCompletionProvider;
let outputChannel: vscode.OutputChannel;
let currentModel: string = '';
let isSuggestionsEnabled: boolean = true;

export function activate(context: vscode.ExtensionContext) {
    console.log('OllaPilot Extension is now active!');

    ollamaService = new OllamaService();
    outputChannel = vscode.window.createOutputChannel('OllaPilot');
    context.subscriptions.push(outputChannel);

    const config = vscode.workspace.getConfiguration('ollapilot');
    isSuggestionsEnabled = config.get<boolean>('enabled', true);
    currentModel = context.globalState.get<string>('selectedModel', '');

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Show output channel command
    const showOutputCmd = vscode.commands.registerCommand('ollapilot.showOutput', () => {
        outputChannel.show(true);
    });
    context.subscriptions.push(showOutputCmd);

    // Inline completion provider
    completionProvider = new OllamaInlineCompletionProvider(ollamaService, currentModel, isSuggestionsEnabled, outputChannel, statusBarItem);
    const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        completionProvider
    );
    context.subscriptions.push(providerDisposable);

    // Config change listener
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ollapilot.enabled')) {
            const newConfig = vscode.workspace.getConfiguration('ollapilot');
            isSuggestionsEnabled = newConfig.get<boolean>('enabled', true);
            completionProvider.setEnabled(isSuggestionsEnabled);
            updateStatusBar();
        }
    });
    context.subscriptions.push(configListener);

    // Toggle command
    const toggleCommand = vscode.commands.registerCommand('customsuggester.toggle', () => {
        isSuggestionsEnabled = !isSuggestionsEnabled;
        config.update('enabled', isSuggestionsEnabled, vscode.ConfigurationTarget.Global);
        completionProvider.setEnabled(isSuggestionsEnabled);
        updateStatusBar();
        vscode.window.showInformationMessage(`Ollama Suggestions ${isSuggestionsEnabled ? 'Enabled' : 'Disabled'}`);
    });
    context.subscriptions.push(toggleCommand);

    // Select model command
    const selectModelCommand = vscode.commands.registerCommand('customsuggester.selectModel', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching Ollama models...",
            cancellable: false
        }, async () => {
            const models = await ollamaService.getModels();
            if (models.length === 0) {
                vscode.window.showErrorMessage('No models found. Make sure Ollama is running and accessible.');
                return;
            }

            const items: vscode.QuickPickItem[] = models.map(m => ({
                label: m.name,
                description: m.name === currentModel ? '(Current)' : ''
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a model for code suggestions'
            });

            if (selected) {
                currentModel = selected.label;
                context.globalState.update('selectedModel', currentModel);
                completionProvider.setModel(currentModel);
                updateStatusBar();
                vscode.window.showInformationMessage(`Selected Ollama model: ${currentModel}`);
            }
        });
    });
    context.subscriptions.push(selectModelCommand);

    // --- Context Menu Commands ---
    registerContextMenuCommand(context, 'ollapilot.improveCode', 'improve');
    registerContextMenuCommand(context, 'ollapilot.summarize', 'summarize');
    registerContextMenuCommand(context, 'ollapilot.elaborate', 'elaborate');

    // Fix command — shows optional input box for describing the issue
    const fixCmd = vscode.commands.registerCommand('ollapilot.fix', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showWarningMessage('Select code first.');
            return;
        }

        const prompt = await vscode.window.showInputBox({
            placeHolder: 'Describe the issue (optional, press Enter to skip)',
            prompt: 'What needs to be fixed? Leave empty to auto-detect bugs.',
        });
        if (prompt === undefined) { return; } // user pressed Escape

        await runCodeTask(editor, selection, selectedText, 'fix', prompt || undefined);
    });
    context.subscriptions.push(fixCmd);

    // Custom prompt — works with or without selection
    const customPromptCmd = vscode.commands.registerCommand('ollapilot.customPrompt', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        const prompt = await vscode.window.showInputBox({
            placeHolder: 'Enter your prompt...',
            prompt: selectedText
                ? 'What would you like to do with the selected code?'
                : 'What would you like to generate?',
        });
        if (!prompt) { return; }

        await runCodeTask(editor, selection, selectedText, 'custom', prompt);
    });
    context.subscriptions.push(customPromptCmd);

    // Status bar setup
    statusBarItem.command = 'customsuggester.selectModel';
    updateStatusBar();
    statusBarItem.show();

    // Auto-select model
    if (!currentModel) {
        ollamaService.getModels().then(models => {
            if (models.length > 0) {
                const defaultModel = models.find(m => isFimCapable(m.name))?.name || models[0].name;
                currentModel = defaultModel;
                context.globalState.update('selectedModel', currentModel);
                completionProvider.setModel(currentModel);
                updateStatusBar();
            }
        });
    }
}

function registerContextMenuCommand(context: vscode.ExtensionContext, commandId: string, taskType: TaskType) {
    const cmd = vscode.commands.registerCommand(commandId, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showWarningMessage('Select code first.');
            return;
        }

        await runCodeTask(editor, selection, selectedText, taskType);
    });
    context.subscriptions.push(cmd);
}

async function runCodeTask(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    selectedText: string,
    taskType: TaskType,
    customPrompt?: string
) {
    if (!currentModel) {
        vscode.window.showWarningMessage('No model selected. Click the status bar to select one.');
        return;
    }

    const taskLabels: Record<TaskType, string> = {
        improve: 'Improving code',
        fix: 'Fixing code',
        summarize: 'Summarizing code',
        elaborate: 'Elaborating code',
        custom: 'Running custom prompt',
    };

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `OllaPilot: ${taskLabels[taskType]}...`,
        cancellable: false,
    }, async () => {
        try {
            const result = await codeTaskGraph.invoke({
                originalCode: selectedText,
                languageId: editor.document.languageId,
                taskType: taskType,
                customPrompt: customPrompt || '',
                model: currentModel,
                baseUrl: getOllamaBaseUrl(),
                result: '',
                error: '',
            });

            if (result.error) {
                vscode.window.showErrorMessage(`OllaPilot error: ${result.error}`);
                return;
            }

            if (!result.result) {
                vscode.window.showWarningMessage('OllaPilot: No result returned.');
                return;
            }

            const output = extractResult(result.result);

            const hasSelection = !selection.isEmpty;

            if (hasSelection) {
                // Any task with selection: replace in-place
                await editor.edit(editBuilder => {
                    editBuilder.replace(selection, output);
                });
            } else {
                // Custom prompt with no selection: insert at cursor
                await editor.edit(editBuilder => {
                    editBuilder.insert(selection.active, output);
                });
            }
        } catch (err: any) {
            console.error('[OllaPilot] Code task error:', err);
            vscode.window.showErrorMessage(`OllaPilot error: ${err?.message || 'Unknown error'}`);
        }
    });
}

/**
 * Extract the actual result from model response, stripping reasoning/explanation.
 *
 * Strategy (in priority order):
 * 1. <result>...</result> tags — most reliable, requested in system prompt
 * 2. Markdown code fences — extract largest code block
 * 3. Fallback — return trimmed text as-is
 */
function extractResult(text: string): string {
    // 1. Try <result> tags (primary strategy)
    // Use lastIndexOf to find the LAST <result> tag — models sometimes mention
    // <result> in their reasoning ("I need to put output in <result> tags"),
    // which creates a false first match.
    const lastResultOpen = text.lastIndexOf('<result>');
    const resultClose = text.indexOf('</result>', lastResultOpen);
    if (lastResultOpen !== -1 && resultClose !== -1 && resultClose > lastResultOpen) {
        let content = text.substring(lastResultOpen + '<result>'.length, resultClose).trim();
        // Strip code fences if the model wrapped the content inside result tags
        content = content.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '');
        return content.trim();
    }

    // 2. Try code fences
    const codeBlockRegex = /```(?:[a-zA-Z]*)\n([\s\S]*?)```/g;
    const blocks: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        const content = match[1].trim();
        if (content.length > 0) {
            blocks.push(content);
        }
    }
    if (blocks.length > 0) {
        return blocks.reduce((a, b) => a.length >= b.length ? a : b);
    }

    // 3. Fallback — try to find where actual content starts after reasoning
    let result = text.trim();

    // Strategy A: Look for structured content start (markdown lists, headings,
    // code blocks, numbered items). The model often outputs reasoning first,
    // then the actual formatted content.
    const contentStartPatterns = [
        /^[-*+] /m,          // markdown bullet list
        /^\d+[.)]\s/m,       // numbered list
        /^#{1,6}\s/m,        // markdown heading
        /^```/m,             // code fence
        /^>\s/m,             // blockquote
        /^\|/m,              // table
    ];

    for (const pattern of contentStartPatterns) {
        const match = result.match(pattern);
        if (match && match.index !== undefined && match.index > 0) {
            // Found structured content — check if there's reasoning text before it
            const before = result.substring(0, match.index).trim();
            // If text before the content looks like reasoning (contains "I", "Let me",
            // conversational phrases), strip it
            if (/\b(I should|I need|Let me|should|need to|might|could|can|will|check|ensure|make sure|alright|okay)\b/i.test(before)) {
                result = result.substring(match.index);
                return result.trim();
            }
        }
    }

    // Strategy B: If there's a clear paragraph break (double newline), and the
    // first paragraph looks like reasoning, take only the last paragraph(s)
    const paragraphs = result.split(/\n\s*\n/);
    if (paragraphs.length >= 2) {
        const firstPara = paragraphs[0].trim();
        if (/\b(I should|I need|Let me|should|need to|might|could|can check|will|alright|okay|that should)\b/i.test(firstPara)) {
            // First paragraph is reasoning — take everything after it
            result = paragraphs.slice(1).join('\n\n').trim();
            if (result.length > 0) {
                return result;
            }
        }
    }

    // Strategy C: Line-by-line filter for remaining reasoning lines
    const lines = result.split('\n');
    const filtered = lines.filter(line => {
        const trimmed = line.trim();
        if (trimmed === '') { return true; }
        if (/^(First,?|Looking|I notice|I'll|I will|Let me|Let's|Wait,?|Hmm,?|So |In conclusion|Alternatively|The (original|current|code|function|user|problem)|Looking at|Okay,?|Now,?|Also,?|But |However,?|This (is|should|would|means)|That's|Here's what|After|Upon|To (condense|summarize|make|do|achieve|fix)|I (should|need|could|would|can)|Alright|Need to|Make sure)/i.test(trimmed)) {
            return false;
        }
        return true;
    });

    result = filtered.join('\n').trim();
    return result || text.trim();
}

function updateStatusBar() {
    const icon = isSuggestionsEnabled ? '$(check)' : '$(circle-slash)';
    const modelText = currentModel ? currentModel : 'No Model';
    statusBarItem.text = `${icon} Ollama: ${modelText}`;
    statusBarItem.tooltip = isSuggestionsEnabled ? 'Ollama Suggestions enabled. Click to change model.' : 'Ollama Suggestions disabled. Click to change model.';
    statusBarItem.color = isSuggestionsEnabled ? '#89d185' : '#f48771';
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
