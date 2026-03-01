/**
 * Multi-stage post-processing pipeline for inline completion results.
 * Cleans up raw model output to produce usable code completions.
 *
 * @param raw - Raw model output
 * @param truncatedPrefix - Text before the cursor (truncated to context window)
 * @param truncatedSuffix - Text after the cursor (truncated to context window)
 * @param isCommentContext - Whether cursor is inside a comment
 */
export function postProcess(raw: string, truncatedPrefix: string, truncatedSuffix: string, isCommentContext: boolean): string | null {
    let text = raw;

    // 1. Strip think blocks — both closed and unclosed (truncated by num_predict)
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
    text = text.replace(/<think>[\s\S]*$/g, '');

    // 2. Strip special tokens (pipe-delimited and DeepSeek fullwidth-bar tokens)
    text = text.replace(/<\|[a-zA-Z_|0-9]+\|>/g, '');
    text = text.replace(/<[\uFF5C][^>]*[\uFF5C]>/g, '');

    // 2.5. Trim leading/trailing whitespace so filler regexes can anchor properly
    text = text.trim();

    // 3. Strip conversational filler (beginning and end)
    text = text.replace(/^(Okay,?|Let's|Let me|First,?|Hmm,?|Well,?|Here is|Here's|Sure,?|I'll|I will|To solve|The following|In this).*\n+/gi, '');
    text = text.replace(/\n+(Okay,?|Let's|Let me|First,?|Hmm,?|Well,?|Here is|Here's|Sure,?|I'll|I will|To solve|The following|In this)[\s\S]*$/gi, '');

    // 4. Prefix deduplication — strip text the model echoed from before the cursor
    if (truncatedPrefix.length > 0) {
        // Get the current line text before the cursor (last line of prefix)
        const lastNewline = truncatedPrefix.lastIndexOf('\n');
        const currentLineBefore = truncatedPrefix.substring(lastNewline + 1);

        if (currentLineBefore.length > 0) {
            // Case 1: completion starts with the full current line — strip it
            if (text.startsWith(currentLineBefore)) {
                text = text.substring(currentLineBefore.length);
            }
            // Case 2: completion starts with the trimmed current line
            else if (text.trimStart().startsWith(currentLineBefore.trim()) && currentLineBefore.trim().length > 2) {
                const trimmedStart = text.trimStart();
                text = trimmedStart.substring(currentLineBefore.trim().length);
            }
        }

        // Also check multi-line prefix echo: if the completion starts with the
        // last N lines of the prefix, strip them
        const prefixLines = truncatedPrefix.split('\n');
        if (prefixLines.length >= 2) {
            const lastFewLines = prefixLines.slice(-3).join('\n');
            if (lastFewLines.length > 5 && text.startsWith(lastFewLines)) {
                text = text.substring(lastFewLines.length);
            }
        }

        text = text.replace(/^\n/, ''); // strip leading newline left after prefix strip

        // Detect prefix looping: if the current-line text re-appears inside the
        // completion body, the model is repeating the full line. Cut at that point.
        const trimmedLine = currentLineBefore.trim();
        if (trimmedLine.length > 10) {
            const loopIndex = text.indexOf(trimmedLine);
            if (loopIndex > 0) {
                text = text.substring(0, loopIndex).trimEnd();
            }
        }

        // Strip leading punctuation overlap: if the prefix ends with punctuation
        // (e.g. ".") and the completion starts with the same, strip the duplicate.
        // "sentence." + ".Next" → "sentence." + "Next"
        const prefixEnd = truncatedPrefix.trimEnd();
        if (prefixEnd.length > 0) {
            const lastChar = prefixEnd[prefixEnd.length - 1];
            if (/[.!?,;:]/.test(lastChar)) {
                // Strip matching leading punctuation (handles "..", ",,", etc.)
                while (text.length > 0 && text[0] === lastChar) {
                    text = text.substring(1);
                }
            }
        }
    }

    // 5. Strip markdown code fences
    text = text.replace(/^```[a-zA-Z]*\n?/gm, '');
    text = text.replace(/\n?```\s*$/g, '');

    // 6. Remove consecutive duplicate lines (model repeating itself)
    const lines = text.split('\n');
    const deduped: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (i > 0 && trimmed.length > 2 && trimmed === lines[i - 1].trim()) {
            continue;
        }
        deduped.push(lines[i]);
    }
    text = deduped.join('\n');

    // 6.5. General repetition loop detection — catches both within-line and
    // cross-line loops where the model repeats a phrase/sentence.
    // Scans for any 25+ char chunk that appears again (non-overlapping).
    {
        const MIN_REPEAT = 25;
        let repeatCut = -1;
        for (let start = 0; start <= text.length - MIN_REPEAT * 2; start++) {
            // Only check at natural boundaries (spaces, punctuation, newlines, start)
            if (start > 0 && !/[\s.!?,;\n]/.test(text[start - 1])) { continue; }
            const chunk = text.substring(start, start + MIN_REPEAT);
            const nextOccurrence = text.indexOf(chunk, start + MIN_REPEAT);
            if (nextOccurrence !== -1) {
                repeatCut = nextOccurrence;
                break;
            }
        }
        if (repeatCut > 0) {
            text = text.substring(0, repeatCut).trimEnd();
        }
    }

    // 7. Runaway generation detection (skip when in comment context)
    if (!isCommentContext) {
        const rl = text.split('\n');
        let fnCount = 0;
        let cutIndex = rl.length;
        for (let i = 0; i < rl.length; i++) {
            const trimmed = rl[i].trim();
            if (/^(export\s+)?(async\s+)?(function|class)\s/.test(trimmed) ||
                /^(def |class |pub fn |fn |public |private |protected )/.test(trimmed) ||
                /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?(\(|function)/.test(trimmed)) {
                fnCount++;
                if (fnCount > 1) {
                    cutIndex = i;
                    break;
                }
            }
        }
        if (cutIndex < rl.length) {
            text = rl.slice(0, cutIndex).join('\n');
        }
    }

    // 8. Suffix deduplication — check first 5 non-trivial suffix lines
    const suffixLines = truncatedSuffix.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    if (suffixLines.length > 0) {
        const completionLines = text.split('\n');
        for (let i = 0; i < Math.min(5, suffixLines.length); i++) {
            const target = suffixLines[i];
            const overlapIndex = completionLines.findIndex(
                (l, idx) => idx > 0 && l.trim().length > 0 && l.trim() === target
            );
            if (overlapIndex > 0) {
                text = completionLines.slice(0, overlapIndex).join('\n');
                break;
            }
        }
    }

    // 9. Final trim
    text = text.trimEnd();

    // 10. Drop if it looks like pure conversation rather than code/comment
    if (/^(Okay|Let me|Hmm|Well|Sure|I'll|I will)[^{]*$/i.test(text.trim())) {
        return null;
    }

    return text.length > 0 ? text : null;
}
