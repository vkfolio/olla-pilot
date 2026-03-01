# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OllaPilot is a VSCode extension that provides GitHub Copilot-style inline code completions powered by local/remote Ollama models. It supports two modes: FIM (Fill-in-the-Middle) for coding models, and chat-mode fallback for general instruct models.

## Build & Development Commands

- **Compile**: `npm run compile` (runs `tsc -p ./`)
- **Watch mode**: `npm run watch`
- **Lint**: `npm run lint` (runs `eslint src --ext ts`)
- **Run extension**: Press `F5` in VSCode to launch Extension Development Host
- **No test framework** is currently configured

## Architecture

Four source files in `src/`, compiled to `out/`:

- **`modelConfig.ts`** — Model capability registry. `getModelFimConfig()` returns FIM tokens/stop tokens per model family (Qwen, DeepSeek, StarCoder, CodeGemma, CodeLlama). `isFimCapable()` detects if a model supports FIM (looks for "coder", "starcoder", "codellama", etc. in name). `isThinkingModel()` detects reasoning models (qwen3, deepseek-r1, qwq) to suppress `<think>` overhead.

- **`ollamaService.ts`** — Dual-mode HTTP client for Ollama. `generateCompletion()` routes based on `isFimCapable()`: FIM-capable models use `/api/generate` with `raw: true` and FIM tokens; non-FIM models use `/api/chat` with a system prompt instructing code-only output. Thinking models get `think: false`. Supports `AbortSignal` for request cancellation. `singleLineMode` adds `\n` to stop tokens for both paths.

- **`inlineCompletionProvider.ts`** — Implements `vscode.InlineCompletionItemProvider`. Key features: comment detection (`isInCommentContext`), mid-line detection, single-line mode (comment/mid-line → `\n` stop token), line-boundary context truncation (2000 chars), 300ms configurable debounce with `AbortController` per request, completion cache (50 entries, 30s TTL), and a multi-stage post-processing pipeline (think blocks, special tokens, trim, filler, markdown fences, duplicate lines, runaway detection, suffix dedup).

- **`extension.ts`** — Entry point. Activates on all files. Manages lifecycle: creates `OllamaService`, registers the provider, sets up status bar, registers commands (`customsuggester.toggle`, `customsuggester.selectModel`). Auto-selects FIM-capable models first. Listens for `onDidChangeConfiguration`.

## Configuration Settings

Defined under `ollapilot.*` in `package.json`:
- `ollapilot.ollamaUrl` — Ollama server URL (default: `http://localhost:11434`)
- `ollapilot.enabled` — Toggle suggestions on/off
- `ollapilot.debounceMs` — Debounce delay in ms (default: 300, range: 100-2000)
