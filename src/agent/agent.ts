import { AgentConfig, resolveModel } from '../config/settings';
import { ChatMessage, Provider, ToolCall } from '../providers/types';
import { ApprovalRequest, PlanStep, ToolContext, TOOL_SPECS, describeTool, executeTool } from './tools';
import { ChangeTracker } from '../workspace/changes';
import { WorkspaceFiles } from '../workspace/files';
import { CommandRunner } from '../terminal/runner';
import { ContextBuilder } from '../context/context';

export interface AgentUi {
    status(text: string): void;
    activity(text: string): void;
    textDelta(delta: string): void;
    assistantDone(text: string): void;
    toolStart(name: string, args: Record<string, unknown>, id: string): void;
    toolEnd(name: string, id: string, summary: string, ok: boolean): void;
    plan(steps: PlanStep[]): void;
    diff(rel: string, before: string | null, after: string): void;
    error(message: string): void;
    approval(req: ApprovalRequest): Promise<boolean>;
    question(question: string): Promise<string | undefined>;
    usage?(input: number, output: number, estimated: boolean): void;
}

export interface AgentDeps {
    cfg: () => AgentConfig;
    ui: () => AgentUi | undefined;
    files: WorkspaceFiles;
    runner: CommandRunner;
    tracker: ChangeTracker;
    memory: import('../memory/memory').MemoryStore;
    provider: () => Provider;
}

const MAX_HISTORY_CHARS = 160_000;

export class Agent {
    private messages: ChatMessage[] = [];
    private cancelled = false;
    private running = false;
    private readonly contextBuilder: ContextBuilder;

    constructor(private readonly deps: AgentDeps) {
        this.contextBuilder = new ContextBuilder(deps.files);
    }

    get isRunning(): boolean {
        return this.running;
    }

    reset(): void {
        this.messages = [];
    }

    stop(): void {
        this.cancelled = true;
        const ui = this.deps.ui();
        ui?.status('Stopping…');
    }

    history(): ChatMessage[] {
        return this.messages;
    }

    /** Restore a persisted conversation (used on reload). */
    loadHistory(messages: ChatMessage[]): void {
        this.messages = Array.isArray(messages)
            ? messages.filter((m) => m && m.role && typeof m.content === 'string')
            : [];
    }

    private toolContext(ui: AgentUi): ToolContext {
        const cfg = this.deps.cfg();
        return {
            root: this.deps.files.root(),
            cfg,
            files: this.deps.files,
            runner: this.deps.runner,
            tracker: this.deps.tracker,
            memory: this.deps.memory,
            token: { get isCancellationRequested() { return false; } },
            approve: (req) => ui.approval(req),
            onPlan: (steps) => ui.plan(steps),
            onActivity: (a) => ui.activity(a),
            onDiff: (rel, before, after) => ui.diff(rel, before, after),
            confirmQuestion: (q) => ui.question(q)
        };
    }

    async send(userText: string, mode: 'ask' | 'agent', extraFiles: string[] = []): Promise<void> {
        if (this.running) {
            throw new Error('Agent is already working. Press Stop first.');
        }
        this.running = true;
        this.cancelled = false;

        const ui = this.deps.ui();
        if (!ui) { this.running = false; throw new Error('Chat view is not ready.'); }

        let totalIn = 0;
        let totalOut = 0;
        let realUsage = false;

        try {
            const cfg = this.deps.cfg();
            ui.status('Preparing context');
            ui.activity('Reading project');

            const bundle = await this.contextBuilder.build(userText, cfg, extraFiles);
            ui.activity('Thinking');

            const userMessage: ChatMessage = {
                role: 'user',
                content:
                    `${userText}\n\n<project_context>\n${bundle.text}\n</project_context>` +
                    (bundle.files.length ? `\n\n(context files: ${bundle.files.join(', ')})` : '')
            };
            this.messages.push(userMessage);
            this.trim();

            const provider = this.deps.provider();
            const tools = mode === 'agent' ? TOOL_SPECS : TOOL_SPECS.filter((t) =>
                ['read_file', 'list_files', 'search_files', 'get_diagnostics', 'get_project_info', 'recall'].includes(t.name)
            );
            const memoryBlock = this.deps.memory.relevantBlock(userText);

            for (let step = 0; step < this.maxSteps(cfg); step++) {
                if (this.cancelled) { break; }

                ui.status(step === 0 ? 'Thinking' : `Working (step ${step + 1})`);
                ui.activity(step === 0 ? 'Thinking' : 'Continuing');

                const result = await provider.stream(
                    [{ role: 'system', content: this.systemPrompt(mode, cfg, memoryBlock) }, ...this.messages],
                    tools,
                    {
                        model: resolveModel(cfg),
                        temperature: cfg.temperature,
                        maxTokens: cfg.maxTokens,
                        onText: (d) => ui.textDelta(d)
                    }
                );

                if (this.cancelled) { break; }

                if (result.usage && (result.usage.input || result.usage.output)) {
                    totalIn += result.usage.input ?? 0;
                    totalOut += result.usage.output ?? 0;
                    realUsage = true;
                    ui.usage?.(totalIn, totalOut, false);
                }

                const calls: ToolCall[] = result.toolCalls || [];
                this.messages.push({
                    role: 'assistant',
                    content: result.text || '',
                    toolCalls: calls.length ? calls : undefined
                });
                ui.assistantDone(result.text || '');

                if (!calls.length) {
                    ui.status('Ready');
                    ui.activity('');
                    return;
                }

                const ctx = this.toolContext(ui);
                for (const call of calls) {
                    if (this.cancelled) { break; }

                    const label = describeTool(call.name, call.args);
                    ui.toolStart(call.name, call.args, call.id);
                    ui.activity(label);

                    let output = '';
                    let ok = true;
                    try {
                        output = await executeTool(call.name, call.args, ctx);
                        ok = !/^(ERROR|BLOCKED|REJECTED)/.test(output);
                    } catch (e: any) {
                        ok = false;
                        output = `ERROR: ${e?.message ?? String(e)}`;
                    }

                    ui.toolEnd(call.name, call.id, firstLine(output), ok);
                    this.messages.push({
                        role: 'tool',
                        toolCallId: call.id,
                        toolName: call.name,
                        content: output.slice(0, 20000)
                    });
                }

                this.trim();
                if (this.cancelled) { break; }
            }

            if (this.cancelled) {
                ui.status('Stopped');
                ui.activity('');
                ui.error('Stopped by user.');
            } else {
                ui.status('Ready');
                ui.activity('');
                const hardLimit = this.maxSteps(cfg);
                if (Number.isFinite(hardLimit)) {
                    ui.error(`Reached the ${hardLimit}-step limit. Ask me to continue.`);
                }
            }
        } catch (e: any) {
            ui?.status('Error');
            ui?.activity('');
            ui?.error(e?.message ?? String(e));
        } finally {
            if (!realUsage) {
                const chars = this.messages.reduce((n, m) => n + m.content.length, 0);
                const estIn = Math.round(chars / 4);
                const estOut = Math.round(this.messages
                    .filter((m) => m.role === 'assistant')
                    .reduce((n, m) => n + m.content.length, 0) / 4);
                if (estIn > 0) { this.deps.ui()?.usage?.(estIn, estOut, true); }
            }
            this.running = false;
            this.cancelled = false;
        }
    }

    /** maxIterations <= 0 means "no step limit" (only the Stop button ends it). */
    private maxSteps(cfg: AgentConfig): number {
        const n = Number(cfg.maxIterations);
        return (!Number.isFinite(n) || n <= 0) ? Number.MAX_SAFE_INTEGER : n;
    }

    private trim(): void {
        const size = () => this.messages.reduce((n, m) => n + m.content.length + 200, 0);
        while (this.messages.length > 8 && size() > MAX_HISTORY_CHARS) {
            // Drop the oldest user/assistant/tool triplet but keep tool pairs consistent
            this.messages.shift();
            while (this.messages.length && this.messages[0].role === 'tool') {
                this.messages.shift();
            }
        }
    }

    private systemPrompt(mode: 'ask' | 'agent', cfg: AgentConfig, memoryBlock = ''): string {
        const root = this.deps.files.root() || '(no folder open)';
        const workspaceName = root.split(/[\\/]/).pop() || 'workspace';

        const shared = `You are "AI Coding Agent", an expert software engineer embedded in Visual Studio Code.

WORKSPACE: ${workspaceName}
ROOT: ${root}
MODE: ${mode === 'agent' ? 'AGENT (you may modify files and run commands)' : 'ASK (read-only; explain and suggest, do not modify files)'}
MODEL: ${resolveModel(cfg)}

LANGUAGE
- Reply in the language the user writes in. Hindi, Hinglish and English are all fine.
- Keep explanations short and concrete. Show code, not essays.

GROUND RULES
1. Never invent file contents. Read a file before editing it.
2. Use apply_edit for surgical changes; write_file only for new files or full rewrites.
3. Preserve unrelated code and the existing architecture. Do not reformat whole files.
4. Before running anything, call get_project_info to learn the real commands. Never guess "npm run dev" blindly.
5. Verify your work: run the build/tests or read diagnostics after meaningful changes, then fix real errors.
6. Never claim something is fixed unless a command/diagnostic confirms it. If verification is impossible, say so explicitly.
7. Ask before destructive actions. Never delete unrelated files.
8. Do not read .env, keys or credential files. Never print secrets.
9. If a task is ambiguous in a way that changes the outcome, use ask_user once - then proceed.

WORKFLOW FOR FEATURE WORK (agent mode)
1. update_plan with the concrete steps.
2. Inspect: list_files / read_file / search_files.
3. Implement with apply_edit / write_file.
4. Verify: run_command for build/test/lint, get_diagnostics, start_server for dev servers.
5. If it fails: read the error, fix the root cause, re-run (limited retries - after 3 failed attempts stop and report).
6. Finish with a short summary: files changed, commands run, how to use the feature, remaining limitations.

STYLE
- Use Markdown: short paragraphs, bullet lists, fenced code blocks with language tags.
- Report progress with the tools instead of narrating.
- When done, state clearly whether the task is verified or unverified.`;

        const memorySection = memoryBlock
            ? `\n\nPERSISTENT MEMORY (facts you already know about this user/project)
${memoryBlock}

Use these without asking again. If the user states something new and durable (preferences, stack choices, conventions, recurring constraints), call the \`remember\` tool. Never store secrets, keys or personal data that is not needed.
`
            : `\n\nPERSISTENT MEMORY\nYou have a memory store. When the user states a durable preference or project fact, call \`remember\`. Use \`recall\` when you need context from earlier sessions.
`;

        if (mode === 'ask') {
            return shared + memorySection + `\n\nYou are in READ-ONLY mode: do not call write_file, apply_edit, delete_file, run_command or start_server.`;
        }
        return shared + memorySection;
    }
}

function firstLine(s: string): string {
    const line = (s || '').split(/\r?\n/).find((l) => l.trim().length);
    return (line ?? '').slice(0, 220);
}
