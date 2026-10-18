import * as vscode from 'vscode';
import { Agent } from './agent/agent';
import { readConfig, getApiKey, setApiKey, deleteApiKey, resolveModel } from './config/settings';
import { createProvider } from './providers';
import { ChatPanel } from './webview/panel';
import { ChangeTracker, DiffContentProvider } from './workspace/changes';
import { WorkspaceFiles } from './workspace/files';
import { CommandRunner } from './terminal/runner';
import { pickProblemForPrompt } from './debug/diagnostics';
import { MemoryStore } from './memory/memory';

let runner: CommandRunner | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let cachedKey: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const files = new WorkspaceFiles(readConfig);
    runner = new CommandRunner();
    const memory = new MemoryStore(context, () => files.root());

    const tracker = new ChangeTracker(async (rel) => {
        try {
            return await files.readText(rel);
        } catch {
            return null;
        }
    });

    const diffProvider = new DiffContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(DiffContentProvider.scheme, diffProvider)
    );

    const refreshKey = async () => {
        cachedKey = await getApiKey(context, readConfig().provider);
    };
    await refreshKey();

    // Resolve @file / @selection references in a prompt
    const resolveRefs = async (text: string) => {
        let out = text;
        const filesOut: string[] = [];

        if (/@selection\b/.test(out)) {
            const ed = vscode.window.activeTextEditor;
            if (ed && !ed.selection.isEmpty) {
                const rel = vscode.workspace.asRelativePath(ed.document.uri);
                const sel = ed.document.getText(ed.selection).slice(0, 8000);
                out = out.replace(/@selection\b/g, `@${rel} (selection)`);
                out += `\n\n<selection file="${rel}" lines="${ed.selection.start.line + 1}-${ed.selection.end.line + 1}">\n${sel}\n</selection>`;
            }
        }

        const re = /@([\w./\\-]+\.\w+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const check = files.resolve(m[1]);
            if (check.ok && check.relative) { filesOut.push(check.relative); }
        }
        return { text: out, files: [...new Set(filesOut)] };
    };

    const panel = new ChatPanel({
        ctx: context,
        buildAgent: (ui) => new Agent({
            cfg: readConfig,
            ui,
            files,
            runner: runner!,
            tracker,
            memory,
            provider: () => {
                const cfg = readConfig();
                return createProvider(cfg, cachedKey);
            }
        }),
        hasKey: async () => {
            const cfg = readConfig();
            if (cfg.provider === 'ollama') { return true; }
            return !!(await getApiKey(context, cfg.provider));
        },
        resolveRefs
    });

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatPanel.viewType, panel, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Deep link:  vscode://arpit-singh.ai-coding-agent/run?prompt=<urlencoded>
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri: async (uri: vscode.Uri) => {
                const q = new URLSearchParams(uri.query || '');
                const action = q.get('action') || '';
                if (action === 'resetData') {
                    await vscode.commands.executeCommand('aiCodingAgent.resetData');
                    return;
                }
                const prompt = q.get('prompt') || q.get('task') || '';
                const mode = q.get('mode') === 'ask' ? 'ask' : 'agent';
                await panel.focus();
                if (prompt.trim()) {
                    await panel.sendPrompt(prompt, mode);
                }
            }
        })
    );

    // ---------------- status bar ----------------
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusItem.command = 'aiCodingAgent.openChat';
    statusItem.tooltip = 'Open AI Coding Agent';
    const updateStatus = () => {
        const cfg = readConfig();
        statusItem!.text = `$(hubot) ${cfg.provider}:${resolveModel(cfg)}`;
        statusItem!.show();
    };
    updateStatus();
    context.subscriptions.push(statusItem);

    // ---------------- helpers ----------------
    const ensureWorkspace = (): boolean => {
        if (!vscode.workspace.workspaceFolders?.length) {
            void vscode.window.showWarningMessage('AI Coding Agent: open a folder/workspace first.');
            return false;
        }
        return true;
    };

    const activeRelPath = (): string | undefined => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return undefined; }
        return vscode.workspace.asRelativePath(editor.document.uri);
    };

    const ask = async (text: string, mode: 'ask' | 'agent' = 'agent') => {
        if (!ensureWorkspace()) { return; }
        if (!(await panel.hasKey())) {
            const go = await vscode.window.showWarningMessage(
                'No API key configured for ' + readConfig().provider + '.',
                'Set API Key'
            );
            if (go) { await vscode.commands.executeCommand('aiCodingAgent.setApiKey'); }
            if (!(await panel.hasKey())) { return; }
        }
        await panel.focus();
        await panel.sendPrompt(text, mode);
    };

    // ---------------- commands ----------------
    const reg = (id: string, fn: (...args: any[]) => any) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    reg('aiCodingAgent.openChat', async () => {
        await panel.focus();
        await panel.pushState();
    });

    reg('aiCodingAgent.askCurrentFile', async () => {
        const rel = activeRelPath();
        if (!rel) {
            void vscode.window.showInformationMessage('Open a file first.');
            return;
        }
        await ask(`Explain @${rel}: what it does, its key parts, and any risks or improvements you see.`, 'ask');
    });

    reg('aiCodingAgent.editSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showInformationMessage('Open a file first.');
            return;
        }
        const selection = editor.document.getText(editor.selection);
        if (!selection.trim()) {
            void vscode.window.showInformationMessage('Select some code first.');
            return;
        }
        const instruction = await vscode.window.showInputBox({
            prompt: 'What should happen to the selected code?',
            placeHolder: 'e.g. refactor into a reusable function'
        });
        if (!instruction) { return; }
        const rel = vscode.workspace.asRelativePath(editor.document.uri);
        const startLine = editor.selection.start.line + 1;
        const endLine = editor.selection.end.line + 1;

        await ask(
            `In @${rel}, lines ${startLine}-${endLine} the user selected this code:\n\n\`\`\`\n${selection.slice(0, 6000)}\n\`\`\`\n\n` +
            `Task: ${instruction}\n\nRead the file first, then apply the change with apply_edit.`,
            'agent'
        );
    });

    reg('aiCodingAgent.explainError', async () => {
        const prompt = await pickProblemForPrompt();
        if (!prompt) {
            void vscode.window.showInformationMessage('No problems found in the Problems panel.');
            return;
        }
        await ask(prompt, 'agent');
    });

    reg('aiCodingAgent.fixCurrentFile', async () => {
        const rel = activeRelPath();
        if (!rel) {
            void vscode.window.showInformationMessage('Open a file first.');
            return;
        }
        await ask(
            `Fix every diagnostic (errors and warnings) reported for @${rel}. ` +
            `Call get_diagnostics first, read the file, apply minimal fixes, then verify the diagnostics are gone.`,
            'agent'
        );
    });

    reg('aiCodingAgent.runProject', async () => {
        if (!ensureWorkspace()) { return; }
        const info = await files.projectInfo();
        const cmd = info.commands.dev || info.commands.start;
        if (!cmd) {
            void vscode.window.showWarningMessage(
                `No dev/start script detected (package manager: ${info.commands.packageManager}).`
            );
            return;
        }
        const ok = await vscode.window.showInformationMessage(`Start the project with "${cmd}"?`, { modal: true }, 'Start');
        if (ok !== 'Start') { return; }
        const h = runner!.start(cmd, info.root || files.root());
        runner!.showTerminalOutput();
        void vscode.window.showInformationMessage(`Started: ${cmd} (id=${h.id}). Output in "AI Coding Agent â€” Terminal".`);
    });

    reg('aiCodingAgent.runTests', async () => {
        if (!ensureWorkspace()) { return; }
        const info = await files.projectInfo();
        const cmd = info.commands.test;
        if (!cmd) {
            void vscode.window.showWarningMessage('No test command detected for this project.');
            return;
        }
        runner!.showTerminalOutput();
        const res = await runner!.run(cmd, info.root || files.root(), 300000);
        const verdict = res.code === 0 ? 'passed' : 'failed';
        void vscode.window.showInformationMessage(`Tests ${verdict} (exit ${res.code}). See output channel.`);
    });

    reg('aiCodingAgent.reviewChanges', async () => {
        const recent = tracker.recent(20);
        if (!recent.length) {
            void vscode.window.showInformationMessage('The agent has not changed any files yet.');
            return;
        }
        const pick = await vscode.window.showQuickPick(
            recent.map((r) => ({
                label: `${r.kind === 'create' ? '$(add)' : r.kind === 'delete' ? '$(trash)' : '$(edit)'} ${r.rel}`,
                description: new Date(r.at).toLocaleTimeString(),
                detail: r.kind,
                rec: r
            })),
            { placeHolder: 'Review an agent change' }
        );
        if (!pick) { return; }
        await tracker.showDiff((pick as any).rec);
    });

    reg('aiCodingAgent.undoLastChange', async () => {
        const msg = await tracker.undoLast(
            async (rel, content) => { await files.writeText(rel, content); },
            async (rel) => { await files.deleteFile(rel); }
        );
        void vscode.window.showInformationMessage(msg);
    });

    reg('aiCodingAgent.undoAllChanges', async () => {
        const ok = await vscode.window.showWarningMessage(
            'Revert every file change made by the agent in this session?',
            { modal: true },
            'Revert All'
        );
        if (ok !== 'Revert All') { return; }
        const msg = await tracker.undoAll(
            async (rel, content) => { await files.writeText(rel, content); },
            async (rel) => { await files.deleteFile(rel); }
        );
        void vscode.window.showInformationMessage(msg);
    });

    reg('aiCodingAgent.stopAgent', () => {
        if (!panel.isRunning) {
            void vscode.window.showInformationMessage('The agent is not running.');
            return;
        }
        panel.stop();
    });

    reg('aiCodingAgent.newChat', async () => {
        panel.reset();
        await panel.focus();
    });

    reg('aiCodingAgent.clearChat', async () => {
        panel.clearSession();
        await vscode.window.showInformationMessage('Chat cleared.');
    });

    reg('aiCodingAgent.chatHistory', async () => {
        const list = panel.sessions();
        const items: any[] = list.slice().reverse().map((s) => ({
            label: `$(comment-discussion) ${s.title}`,
            description: new Date(s.at).toLocaleString(),
            detail: `${s.transcript.length} messages`,
            id: s.id
        }));
        if (list.length) {
            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            items.push({ label: '$(trash) Delete all chat history', id: '__purge' });
        }
        if (!items.length) {
            void vscode.window.showInformationMessage('No saved chats yet.');
            return;
        }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Open a past chat' });
        if (!pick) { return; }
        if ((pick as any).id === '__purge') {
            const ok = await vscode.window.showWarningMessage('Delete all saved chats?', { modal: true }, 'Delete All');
            if (ok === 'Delete All') {
                panel.clearAllSessions();
                void vscode.window.showInformationMessage('Chat history deleted.');
            }
            return;
        }
        await panel.focus();
        if (!panel.restoreSession((pick as any).id)) {
            void vscode.window.showWarningMessage('Could not restore that chat.');
        }
    });

    reg('aiCodingAgent.clearSession', async () => {
        const ok = await vscode.window.showWarningMessage(
            'Clear the current session (chat + plan)? Memory stays.',
            { modal: true },
            'Clear Session'
        );
        if (ok === 'Clear Session') {
            panel.clearSession();
        }
    });

    reg('aiCodingAgent.resetData', async () => {
        panel.clearSession();
        panel.clearAllSessions();
        await vscode.window.showInformationMessage('Chat data cleared (transcript, history, saved sessions).');
    });

    reg('aiCodingAgent.setApiKey', async () => {
        const cfg = readConfig();
        const key = await vscode.window.showInputBox({
            title: `API key for ${cfg.provider}`,
            prompt: 'Stored in VS Code SecretStorage (never written to settings files).',
            password: true,
            ignoreFocusOut: true
        });
        if (!key) { return; }
        await setApiKey(context, cfg.provider, key.trim());
        await refreshKey();
        await panel.pushState();
        void vscode.window.showInformationMessage(`API key saved for ${cfg.provider}.`);
    });

    reg('aiCodingAgent.clearApiKey', async () => {
        const cfg = readConfig();
        await deleteApiKey(context, cfg.provider);
        await refreshKey();
        await panel.pushState();
        void vscode.window.showInformationMessage(`API key removed for ${cfg.provider}.`);
    });

    reg('aiCodingAgent.openSettings', async () => {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'aiCodingAgent');
    });

    reg('aiCodingAgent.showMemory', async () => {
        const entries = memory.all();
        if (!entries.length) {
            const add = await vscode.window.showInformationMessage(
                'Memory is empty. The agent saves facts automatically, or you can add one.',
                'Add Memory'
            );
            if (add === 'Add Memory') {
                const text = await vscode.window.showInputBox({ prompt: 'What should the agent remember?', ignoreFocusOut: true });
                if (text) {
                    memory.add(text, ['manual']);
                    void vscode.window.showInformationMessage('Saved to memory.');
                }
            }
            return;
        }
        const pick = await vscode.window.showQuickPick(
            entries.slice().reverse().map((m) => ({
                label: `$(bookmark) ${m.text.slice(0, 90)}`,
                description: new Date(m.createdAt).toLocaleDateString(),
                detail: m.tags.length ? 'tags: ' + m.tags.join(', ') : undefined,
                id: m.id
            })),
            { placeHolder: `${entries.length} memories — pick one to delete`, matchOnDescription: true }
        );
        if (!pick) { return; }
        const del = await vscode.window.showWarningMessage('Delete this memory?', { modal: true }, 'Delete');
        if (del === 'Delete') {
            memory.remove((pick as any).id);
            void vscode.window.showInformationMessage('Memory deleted.');
        }
    });

    reg('aiCodingAgent.clearMemory', async () => {
        const count = memory.all().length;
        if (!count) {
            void vscode.window.showInformationMessage('Memory is already empty.');
            return;
        }
        const ok = await vscode.window.showWarningMessage(`Delete all ${count} memories?`, { modal: true }, 'Delete All');
        if (ok === 'Delete All') {
            memory.clear();
            void vscode.window.showInformationMessage('Memory cleared.');
        }
    });

    // ---------------- config changes ----------------
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (!e.affectsConfiguration('aiCodingAgent')) { return; }
            await refreshKey();
            updateStatus();
            await panel.pushState();
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => { /* reserved for context hints */ })
    );
}

export function deactivate(): void {
    runner?.dispose();
    runner = undefined;
    statusItem?.dispose();
    statusItem = undefined;
}

