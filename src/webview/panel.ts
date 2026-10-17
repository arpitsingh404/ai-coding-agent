import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { Agent, AgentUi } from '../agent/agent';
import { ApprovalRequest, PlanStep } from '../agent/tools';
import { AgentConfig, readConfig } from '../config/settings';
import { providerInfo } from '../providers';
import { getHtml, UiState } from './ui';

export class ChatPanel implements vscode.WebviewViewProvider, AgentUi {
    static readonly viewType = 'aiCodingAgent.chatView';

    private view?: vscode.WebviewView;
    private agent: Agent | undefined;
    private mode: 'ask' | 'agent' = 'agent';
    private readonly approvals = new Map<string, (ok: boolean) => void>();
    private lastDiff: { rel: string; before: string | null; after: string } | undefined;

    constructor(
        private readonly ctx: vscode.ExtensionContext,
        private readonly buildAgent: (ui: () => AgentUi | undefined) => Agent,
        private readonly hasKeyFn: () => Promise<boolean>
    ) {}

    attachAgent(agent: Agent): void {
        this.agent = agent;
        agent.reset();
    }

    get isRunning(): boolean {
        return this.agent?.isRunning ?? false;
    }

    async hasKey(): Promise<boolean> {
        return this.hasKeyFn();
    }

    reset(): void {
        this.agent?.reset();
        this.post({ type: 'done' });
    }

    stop(): void {
        this.agent?.stop();
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };

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
                    await this.pushState();
                    break;
                case 'send':
                    await this.sendPrompt(String(msg.text ?? ''), msg.mode === 'ask' ? 'ask' : 'agent');
                    break;
                case 'stop':
                    this.agent?.stop();
                    break;
                case 'newChat':
                    this.agent?.reset();
                    this.post({ type: 'done' });
                    break;
                case 'approval': {
                    const resolve = this.approvals.get(String(msg.id));
                    if (resolve) {
                        this.approvals.delete(String(msg.id));
                        resolve(msg.accepted === true);
                    }
                    break;
                }
                case 'mode':
                    this.mode = msg.mode === 'ask' ? 'ask' : 'agent';
                    break;
                case 'settings':
                    void vscode.commands.executeCommand('aiCodingAgent.openSettings');
                    break;
            }
        });

        view.onDidChangeVisibility(async () => {
            if (view.visible) { await this.pushState(); }
        });
    }

    async pushState(): Promise<void> {
        const cfg = readConfig();
        this.post({
            type: 'state',
            state: {
                provider: cfg.provider,
                model: providerInfo(cfg, false).model,
                mode: this.mode,
                hasKey: await this.hasKey()
            }
        });
    }

    async focus(): Promise<void> {
        await vscode.commands.executeCommand('aiCodingAgent.chatView.focus');
    }

    async sendPrompt(text: string, mode?: 'ask' | 'agent'): Promise<void> {
        if (!text.trim()) { return; }
        if (!this.agent) {
            this.agent = this.buildAgent(() => this);
            this.agent.reset();
        }
        if (mode) { this.mode = mode; }
        await this.pushState();
        this.post({ type: 'userEcho', text });
        this.post({ type: 'status', text: 'Working' });

        try {
            await this.agent.send(text, this.mode);
        } catch (e: any) {
            this.error(e?.message ?? String(e));
        } finally {
            this.post({ type: 'done' });
            this.post({ type: 'status', text: 'Ready' });
        }
    }

    // ---------- AgentUi implementation ----------

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
        this.post({ type: 'toolEnd', name: 'diff', id: 'diff-' + Date.now(), summary: `Updated ${rel}`, ok: true });
    }

    error(message: string): void {
        this.post({ type: 'error', text: message });
    }

    async approval(req: ApprovalRequest): Promise<boolean> {
        const id = randomBytes(8).toString('hex');
        const answer = new Promise<boolean>((resolve) => {
            this.approvals.set(id, resolve);
        });
        this.post({ type: 'approval', id, req });
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
