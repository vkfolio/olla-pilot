import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export type TaskType = 'improve' | 'fix' | 'summarize' | 'elaborate' | 'custom';

const CodeTaskAnnotation = Annotation.Root({
    originalCode: Annotation<string>,
    languageId: Annotation<string>,
    taskType: Annotation<TaskType>,
    customPrompt: Annotation<string>,
    model: Annotation<string>,
    baseUrl: Annotation<string>,
    result: Annotation<string>,
    error: Annotation<string>,
});

type CodeTaskState = typeof CodeTaskAnnotation.State;

const RESULT_TAG_INSTRUCTION = '\n\nCRITICAL: You MUST wrap your entire output between <result> and </result> tags. Put ONLY the final content inside the tags — no explanations, no reasoning, no commentary. Any text outside the tags will be discarded.';

const TASK_PROMPTS: Record<TaskType, { system: string; userPrefix: string }> = {
    improve: {
        system: 'You are an improvement engine. You receive content and output an improved version. Do NOT explain your changes. Do NOT add commentary. Output ONLY the improved content between <result> and </result> tags.' + RESULT_TAG_INSTRUCTION,
        userPrefix: 'Improve the following for readability, clarity, and best practices:\n\n',
    },
    fix: {
        system: 'You are a fixing engine. You receive content and output a corrected version. Do NOT explain what you changed. Do NOT describe the bugs. Output ONLY the fixed content between <result> and </result> tags.' + RESULT_TAG_INSTRUCTION,
        userPrefix: 'Fix the issues in the following:\n\n',
    },
    summarize: {
        system: 'You are a technical writer. Summarize what the following does in concise bullet points. Put your summary between <result> and </result> tags.' + RESULT_TAG_INSTRUCTION,
        userPrefix: 'Summarize the following:\n\n',
    },
    elaborate: {
        system: 'You are a documentation engine. Add detailed inline comments explaining each section. Output ONLY the content with comments added between <result> and </result> tags. Do NOT add explanations outside the tags.' + RESULT_TAG_INSTRUCTION,
        userPrefix: 'Add detailed comments to the following:\n\n',
    },
    custom: {
        system: 'You are a helpful assistant. Follow the user\'s instructions precisely. Put your entire output between <result> and </result> tags.' + RESULT_TAG_INSTRUCTION,
        userPrefix: '',
    },
};

async function executeTask(state: CodeTaskState): Promise<Partial<CodeTaskState>> {
    try {
        const llm = new ChatOllama({
            model: state.model,
            baseUrl: state.baseUrl,
            temperature: 0.2,
        });

        const taskConfig = TASK_PROMPTS[state.taskType];

        let userContent: string;
        if (state.taskType === 'custom' && !state.originalCode) {
            // No selection — generation mode, just the prompt
            userContent = state.customPrompt;
        } else if (state.taskType === 'custom') {
            userContent = `${state.customPrompt}\n\nCode (${state.languageId}):\n\n${state.originalCode}`;
        } else if (state.taskType === 'fix' && state.customPrompt) {
            userContent = `${taskConfig.userPrefix}${state.customPrompt}\n\n${state.originalCode}`;
        } else {
            userContent = `${taskConfig.userPrefix}${state.originalCode}`;
        }

        const messages = [
            new SystemMessage(taskConfig.system),
            new HumanMessage(userContent),
        ];

        const response = await llm.invoke(messages);
        let content = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

        // Strip <think> blocks (some models emit reasoning in these)
        content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
        content = content.replace(/<think>[\s\S]*$/g, '');

        return { result: content };
    } catch (err: any) {
        return { error: err?.message || 'Unknown error during task execution' };
    }
}

const workflow = new StateGraph(CodeTaskAnnotation)
    .addNode('executeTask', executeTask)
    .addEdge(START, 'executeTask')
    .addEdge('executeTask', END);

export const codeTaskGraph = workflow.compile();

export type { CodeTaskState };
