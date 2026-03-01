# 🛸 OllaPilot

**OllaPilot** is a lightning-fast, privacy-first VSCode extension that provides GitHub Copilot-style inline code suggestions powered by [Ollama](https://ollama.com/). Keep your code completely local, or connect to a powerful remote server—the choice is yours.

---

## ✨ Features

- **Inline Ghost Text**: Seamless, real-time code completion as you type.
- **Local & Remote Support**: Connect to `localhost` for maximum privacy or point to your beefy remote server URL for better models.
- **Model Switching On-The-Fly**: Easily switch between your installed Ollama models right from the VSCode Status Bar.
- **Toggle Suggestions**: Quickly turn suggestions On or Off via the Command Palette.
- **Smart Context**: Reads your surrounding code structure for smarter completions using Fill-in-the-Middle (FIM) techniques.

## 🚀 Getting Started

### Prerequisites

1. Install [Ollama](https://ollama.com/).
2. Pull a model tailored for coding. **Note**: Base coding models work best for Fill-in-the-Middle (FIM) autocomplete. Instruct/Reasoning models (like `qwen` or `deepseek-r1`) might return chat formatting or "thinking" blocks instead of raw code.
   Recommended models:
   - `starcoder2`
   - `qwen2.5-coder` (Base model preferred over Instruct)
   - `deepseek-coder`
   
   ```bash
   ollama pull qwen2.5-coder
   ```

### Installation (Development)

Currently, the extension is in development mode. To run it:

1. Clone or open the repository in VSCode.
2. Open terminal and run to install dependencies:
   ```bash
   npm install
   ```
3. Press **`F5`** to launch the Extension Development Host.
4. Open any file in the new window and start typing!

## ⚙️ Configuration

You can configure OllaPilot through VSCode's standard Settings UI (`Ctrl + ,` or `Cmd + ,`).

| Setting | Type | Default | Description |
| ------- | ---- | ------- | ----------- |
| `ollapilot.ollamaUrl` | `string` | `http://localhost:11434` | The API URL to your local or remote Ollama instance. (e.g., `https://my-cloud-ollama.com:11434`) |
| `ollapilot.enabled`   | `boolean`| `true` | Globally enable or disable code suggestions. |

## 🎮 Usage

### The Status Bar

Look at the bottom-right corner of your VSCode editor. You will see the **OllaPilot Indicator**.

- `[✓] Ollama: qwen2.5-coder` 🟢 Suggestions are **Active**.
- `[⊘] Ollama: No Model` 🔴 Suggestions are **Disabled** or waiting for config.

**Click the Status Bar Item** to open a quick-pick menu of all models currently pulled on your Ollama server. Choose a different model and OllaPilot switches instantly.

### Command Palette

Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and search for:
- **`Ollama Suggestions: Toggle On/Off`**: Master switch to pause suggestions.
- **`Ollama Suggestions: Select Model`**: Same as clicking the status bar.

## 🛠️ How it Works

OllaPilot utilizes VSCode's `InlineCompletionItemProvider` API. As you type, the extension reads the text directly before and after your cursor. It debounces the keystrokes (wait 500ms) to prevent overwhelming your local machine, and then dispatches a highly-tailored prompt to your Ollama API.

---

*Fly through your codebase with OllaPilot.* 🛸
