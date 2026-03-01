import * as vscode from 'vscode';
import { OllamaService } from './ollamaService';
import { OllamaInlineCompletionProvider } from './inlineCompletionProvider';

let statusBarItem: vscode.StatusBarItem;
let ollamaService: OllamaService;
let completionProvider: OllamaInlineCompletionProvider;
let currentModel: string = '';
let isSuggestionsEnabled: boolean = true;

export function activate(context: vscode.ExtensionContext) {
    console.log('Custom Suggester Extension is now active!');

    // Initialize dependencies
    ollamaService = new OllamaService();

    // Load config
    const config = vscode.workspace.getConfiguration('ollapilot');
    isSuggestionsEnabled = config.get<boolean>('enabled', true);
    currentModel = context.globalState.get<string>('selectedModel', ''); // Restore saved model

    // Initialize Status Bar Profile
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Initialize Provider
    completionProvider = new OllamaInlineCompletionProvider(ollamaService, currentModel, isSuggestionsEnabled);
    const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' }, // All files
        completionProvider
    );
    context.subscriptions.push(providerDisposable);

    // Register Commands
    const toggleCommand = vscode.commands.registerCommand('customsuggester.toggle', () => {
        isSuggestionsEnabled = !isSuggestionsEnabled;
        config.update('enabled', isSuggestionsEnabled, vscode.ConfigurationTarget.Global);
        completionProvider.setEnabled(isSuggestionsEnabled);
        updateStatusBar();
        vscode.window.showInformationMessage(`Ollama Suggestions ${isSuggestionsEnabled ? 'Enabled' : 'Disabled'}`);
    });
    context.subscriptions.push(toggleCommand);

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

    // On-click action for status bar
    statusBarItem.command = 'customsuggester.selectModel';

    // Initial status bar update
    updateStatusBar();
    statusBarItem.show();

    // Try to auto-select a model if none is selected
    if (!currentModel) {
        ollamaService.getModels().then(models => {
            if (models.length > 0) {
                // Default to standard coding models if they exist, else first
                const defaultModel = models.find(m => m.name.includes('coder') || m.name.includes('starcoder') || m.name.includes('qwen'))?.name || models[0].name;
                currentModel = defaultModel;
                context.globalState.update('selectedModel', currentModel);
                completionProvider.setModel(currentModel);
                updateStatusBar();
            }
        });
    }
}

function updateStatusBar() {
    const icon = isSuggestionsEnabled ? '$(check)' : '$(circle-slash)';
    const modelText = currentModel ? currentModel : 'No Model';
    statusBarItem.text = `${icon} Ollama: ${modelText}`;
    statusBarItem.tooltip = isSuggestionsEnabled ? 'Ollama Suggestions enabled. Click to change model.' : 'Ollama Suggestions disabled. Click to change model.';

    // Suggestion color
    statusBarItem.color = isSuggestionsEnabled ? '#89d185' : '#f48771'; // Green / Redish
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
