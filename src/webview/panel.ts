import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { Agent, AgentUi } from '../agent/agent';
import { ApprovalRequest, PlanStep } from '../agent/tools';
import { readConfig } from '../config/settings';
import { providerInfo } from '../providers';
import { getHtml, UiState } from './ui';

export interface ResolvedRefs {
    text: string;
    files: string[];
}

export interface PanelDeps {
    ctx: vscode.ExtensionContext;
    buildAgent: (ui: () => AgentUi | undefined) => Agent;
    hasKey: () => Promise<boolean>;
    resolveRefs: (text: string) => Promise<ResolvedRefs>;
}

interface TranscriptEntry {
    role: 'user' | 'assistant';
    text: string;
}

export interface SessionRecord {
    id: string;
    title: string;
    at: number;
    transcript: TranscriptEntry[];
}

const TRANSCRIPT_KEY = 'aiCodingAgent.transcript';
const HISTORY_KEY = 'aiCodingAgent.history';
const SESSIONS_KEY = 'aiCodingAgent.sessions';
const MAX_SESSIONS = 20;

export class ChatPanel implements vscode.WebviewViewProvider, AgentUi {
    static readonly viewType = 'aiCodingAgent.chatView';

    private view?: vscode.WebviewView;
    private agent: Agent | undefined;
    private mode: 'ask' | 'agent' = 'agent';
    private readonly approvals = new Map<string, (ok: boolean) => void>();
    private readonly alwaysAllow = new Set<string>();
    private transcript: TranscriptEntry[] = [];
    private readonly queue: Array<{ text: string; mode: 'ask' | 'agent' }> = [];
    private lastDiff: { rel: string; before: string | null; after: string } | undefined;

    constructor(private readonly deps: PanelDeps) {
        const saved = deps.ctx.globalState?.get<TranscriptEntry[]>(TRANSCRIPT_KEY);
        this.transcript = Array.isArray(saved) ? saved : [];
    }

    attachAgent(agent: Agent): void {
        this.agent = agent;
        agent.reset();
    }

    get isRunning(): boolean {
        return this.agent?.isRunning ?? false;
    }

    async hasKey(): Promise<boolean> {
        return this.deps.hasKey();
    }

    reset(): void {
        this.archiveSession();
        this.agent?.reset();
        this.transcript = [];
        void this.deps.ctx.globalState.update(TRANSCRIPT_KEY, []);
        void this.deps.ctx.globalState.update(HISTORY_KEY, []);
        this.post({ type: 'cleared' });
        this.post({ type: 'done' });
    }

    /** Clear the current session without archiving it. */
    clearSession(): void {
        this.agent?.reset();
        this.transcript = [];
        void this.deps.ctx.globalState.update(TRANSCRIPT_KEY, []);
        void this.deps.ctx.globalState.update(HISTORY_KEY, []);
        this.post({ type: 'cleared' });
        this.post({ type: 'done' });
    }

    sessions(): SessionRecord[] {
        const raw = this.deps.ctx.globalState.get<SessionRecord[]>(SESSIONS_KEY);
        return Array.isArray(raw) ? raw : [];
    }

    /** Archive the current conversation so it can be reopened later. */
    private archiveSession(): void {
        if (!this.transcript.length) { return; }
        const firstUser = this.transcript.find((t) => t.role === 'user');
        const list = this.sessions();
        list.push({
            id: Math.random().toString(36).slice(2, 10),
            title: (firstUser?.text ?? 'Chat').replace(/\s+/g, ' ').slice(0, 70),
            at: Date.now(),
            transcript: this.transcript.slice(-40)
        });
        void this.deps.ctx.globalState.update(SESSIONS_KEY, list.slice(-MAX_SESSIONS));
    }

    restoreSession(id: string): boolean {
        const found = this.sessions().find((s) => s.id === id);
        if (!found) { return false; }
        this.agent?.reset();
        this.transcript = found.transcript.slice();
        this.persist();
        this.post({ type: 'cleared' });
        this.post({ type: 'history', messages: this.transcript });
        return true;
    }

    deleteSession(id: string): boolean {
        const list = this.sessions();
        const next = list.filter((s) => s.id !== id);
        if (next.length === list.length) { return false; }
        void this.deps.ctx.globalState.update(SESSIONS_KEY, next);
        return true;
    }

    clearAllSessions(): void {
        void this.deps.ctx.globalState.update(SESSIONS_KEY, []);
    }

    stop(): void {
        this.agent?.stop();
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };

        const nonce = randomBytes(16).toString('base64');
        const cfg = readConfig();
        const state: UiState = {
            provider: cfg.provider,
            model: providerInfo(cfg, false).model,
            mode: this.mode,
            hasKey: false
        };
        view.webview.html = getHtml(nonce, state);

        view.webview.onDidReceiveMessage(async (msg) => {
            switch (msg?.type) {
                case 'ready':
                    await this.restoreTranscript();
                    await this.pushState();
                    break;
                case 'send':
                    await this.sendPrompt(String(msg.text ?? ''), msg.mode === 'ask' ? 'ask' : 'agent');
                    break;
                case 'stop':
                    this.agent?.stop();
                    break;
                case 'newChat':
                    this.reset();
                    break;
                case 'approval': {
                    const id = String(msg.id);
                    const resolve = this.approvals.get(id);
                    if (resolve) {
                        this.approvals.delete(id);
                        if (msg.accepted === true && msg.always === true) {
                            const cmd = String(msg.command ?? '');
                            if (cmd) { this.alwaysAllow.add(cmd); }
                        }
                        resolve(msg.accepted === true);
                    }
                    break;
                }
                case 'mode':
                    this.mode = msg.mode === 'ask' ? 'ask' : 'agent';
                    await this.deps.ctx.globalState.update('aiCodingAgent.mode', this.mode);
                    break;
                case 'action':
                    await this.handleAction(String(msg.action ?? ''));
                    break;
                case 'selectModel': {
                    const provider = String(msg.provider ?? '');
                    const model = String(msg.model ?? '');
                    if (!provider || !model) { break; }
                    const cfg = vscode.workspace.getConfiguration('aiCodingAgent');
                    await cfg.update('provider', provider, vscode.ConfigurationTarget.Global);
                    await cfg.update('model', model, vscode.ConfigurationTarget.Global);
                    await this.pushState();
                    this.post({ type: 'info', text: `Model switched to **${model}** (\`${provider}\`).` });
                    break;
                }
                case 'settings':
                    void vscode.commands.executeCommand('aiCodingAgent.openSettings');
                    break;
            }
        });

        view.onDidChangeVisibility(async () => {
            if (view.visible) { await this.pushState(); }
        });
    }

    private async handleAction(action: string): Promise<void> {
        switch (action) {
            case 'new':
                this.reset();
                break;
            case 'clear':
                await vscode.commands.executeCommand('aiCodingAgent.clearChat');
                break;
            case 'clearSession':
                this.clearSession();
                break;
            case 'history':
                await vscode.commands.executeCommand('aiCodingAgent.chatHistory');
                break;
            case 'memory':
                await vscode.commands.executeCommand('aiCodingAgent.showMemory');
                break;
            case 'settings':
                await vscode.commands.executeCommand('aiCodingAgent.openSettings');
                break;
        }
    }

    private async restoreTranscript(): Promise<void> {
        if (!this.transcript.length) { return; }
        this.post({ type: 'history', messages: this.transcript });
        const saved = this.deps.ctx.globalState.get<any[]>(HISTORY_KEY) ?? [];
        if (saved.length && this.agent && !this.agent.history().length) {
            this.agent.loadHistory(saved.slice(-30));
        }
    }

    private persist(): void {
        if (this.transcript.length > 120) {
            this.transcript = this.transcript.slice(-120);
        }
        void this.deps.ctx.globalState.update(TRANSCRIPT_KEY, this.transcript);
        const hist = (this.agent?.history() ?? []).slice(-40)
            .map((m) => ({ role: m.role, content: m.content, toolCallId: m.toolCallId, toolName: m.toolName }));
        void this.deps.ctx.globalState.update(HISTORY_KEY, hist);
    }

    async pushState(): Promise<void> {
        const cfg = readConfig();
        this.post({
            type: 'state',
            state: {
                provider: cfg.provider,
                model: providerInfo(cfg, false).model,
                mode: this.mode,
                hasKey: await this.deps.hasKey()
            }
        });
    }

    async focus(): Promise<void> {
        await vscode.commands.executeCommand('aiCodingAgent.chatView.focus');
    }

    /** Handles slash commands. Returns null when the text should be sent to the model. */
    private async handleSlash(text: string): Promise<{ send?: string; mode?: 'ask' | 'agent' } | null> {
        const m = text.match(/^\/([a-z]+)\s*([\s\S]*)$/i);
        if (!m) { return null; }
        const cmd = m[1].toLowerCase();
        const rest = m[2].trim();

        switch (cmd) {
            case 'help':
                this.post({
                    type: 'info',
                    text: [
                        '**Slash commands**',
                        '- `/explain [file]` — explain code (read-only)',
                        '- `/fix [file]` — fix diagnostics',
                        '- `/test` — run the project test command',
                        '- `/run` — start the dev server',
                        '- `/plan <task>` — plan first, then execute',
                        '- `/clear` — new chat',
                        '- `@path/to/file` — attach a file to the message',
                        '- `@selection` — attach the current editor selection'
                    ].join('\n')
                });
                return {};
            case 'clear':
            case 'new':
                this.reset();
                return {};
            case 'explain':
                return { send: `Explain ${rest ? '@' + rest : 'the active file'}: purpose, structure, risks and improvement ideas.`, mode: 'ask' };
            case 'fix':
                return { send: `Fix every diagnostic reported for ${rest ? '@' + rest : 'the active file'}. Read it, apply minimal fixes, then verify with get_diagnostics.`, mode: 'agent' };
            case 'test':
                return { send: 'Run the project test command, read the output, and fix failures if any. Report the final result.', mode: 'agent' };
            case 'run':
                return { send: 'Start the dev server for this project and report the local URL.', mode: 'agent' };
            case 'plan':
                return { send: `Create a plan for this task with update_plan, then execute it step by step: ${rest}`, mode: 'agent' };
            default:
                this.post({ type: 'info', text: `Unknown command \`/${cmd}\`. Type \`/help\`.` });
                return {};
        }
    }

    async sendPrompt(rawText: string, mode?: 'ask' | 'agent'): Promise<void> {
        const input = (rawText ?? '').trim();
        if (!input) { return; }

        if (!this.agent) {
            this.agent = this.deps.buildAgent(() => this);
        }

        // Already working? Queue it instead of dropping the message.
        if (this.agent.isRunning) {
            this.queue.push({ text: input, mode: mode ?? this.mode });
            this.post({ type: 'queued', text: input, position: this.queue.length });
            return;
        }

        await this.runPrompt(input, mode);
    }

    /** Send the next queued message, if any. */
    private async drainQueue(): Promise<void> {
        if (this.agent?.isRunning) { return; }
        const next = this.queue.shift();
        if (!next) { return; }
        this.post({ type: 'dequeued', text: next.text, remaining: this.queue.length });
        await this.runPrompt(next.text, next.mode);
    }

    private async runPrompt(rawText: string, mode?: 'ask' | 'agent'): Promise<void> {
        const input = (rawText ?? '').trim();
        if (!input) { return; }

        if (!this.agent) {
            this.agent = this.deps.buildAgent(() => this);
        }
        if (mode) { this.mode = mode; }

        const slash = await this.handleSlash(input);
        if (slash && !slash.send) {
            void this.drainQueue();
            return;
        }
        const text = slash?.send ?? input;
        const effectiveMode = slash?.mode ?? this.mode;

        const refs = await this.deps.resolveRefs(text);
        this.post({ type: 'userEcho', text: input });
        this.transcript.push({ role: 'user', text: input });
        this.persist();

        await this.pushState();
        this.post({ type: 'status', text: 'Working' });

        try {
            await this.agent.send(refs.text, effectiveMode, refs.files);
        } catch (e: any) {
            this.error(e?.message ?? String(e));
        } finally {
            this.post({ type: 'done' });
            this.post({ type: 'status', text: 'Ready' });
            this.persist();
            // auto-send anything the user queued while the agent was busy
            void this.drainQueue();
        }
    }

    // ---------- AgentUi ----------

    status(text: string): void {
        this.post({ type: 'status', text });
    }

    activity(text: string): void {
        this.post({ type: 'activity', text });
    }

    textDelta(delta: string): void {
        this.post({ type: 'delta', text: delta });
    }

    assistantDone(text: string): void {
        this.post({ type: 'assistant', text });
        if (text && text.trim()) {
            this.transcript.push({ role: 'assistant', text });
            this.persist();
        }
    }

    toolStart(name: string, args: Record<string, unknown>, id: string): void {
        this.post({ type: 'toolStart', name, args, id });
    }

    toolEnd(name: string, id: string, summary: string, ok: boolean): void {
        this.post({ type: 'toolEnd', name, id, summary, ok });
    }

    plan(steps: PlanStep[]): void {
        this.post({ type: 'plan', steps });
    }

    diff(rel: string, before: string | null, after: string): void {
        this.lastDiff = { rel, before, after };
        this.post({ type: 'fileChanged', rel });
    }

    error(message: string): void {
        this.post({ type: 'error', text: message });
    }

    usage(input: number, output: number, estimated: boolean): void {
        this.post({ type: 'usage', input, output, estimated });
    }

    async approval(req: ApprovalRequest): Promise<boolean> {
        if (req.kind === 'command' && req.command && this.alwaysAllow.has(req.command)) {
            return true;
        }
        const id = randomBytes(8).toString('hex');
        const answer = new Promise<boolean>((resolve) => {
            this.approvals.set(id, resolve);
        });
        this.post({ type: 'approval', id, req: { ...req, command: req.command } });
        return answer;
    }

    async question(question: string): Promise<string | undefined> {
        this.post({ type: 'info', text: `**Agent asks:** ${question}` });
        return vscode.window.showInputBox({
            prompt: question,
            placeHolder: 'Your answer (Enter to send)',
            ignoreFocusOut: true
        });
    }

    private post(msg: unknown): void {
        this.view?.webview.postMessage(msg);
    }
}
