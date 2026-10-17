import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export interface RunResult {
    command: string;
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
}

export interface ServerHandle {
    id: string;
    command: string;
    child: ChildProcess;
    startedAt: number;
    url?: string;
    output: string;
    running: boolean;
}

const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;
const URL_RE = /(https?:\/\/[^\s"'`<>]+)/i;

export function stripAnsi(s: string): string {
    return s.replace(ANSI, '');
}

/** Keep the tail of long output so the model gets signal, not megabytes. */
export function tail(text: string, maxChars = 12000): string {
    if (text.length <= maxChars) { return text; }
    return '…(truncated)…\n' + text.slice(text.length - maxChars);
}

export class CommandRunner {
    private readonly servers = new Map<string, ServerHandle>();
    private readonly channel: vscode.OutputChannel;

    constructor() {
        this.channel = vscode.window.createOutputChannel('AI Coding Agent — Terminal');
    }

    dispose(): void {
        for (const s of this.servers.values()) { this.killTree(s.child); }
        this.servers.clear();
        this.channel.dispose();
    }

    get output(): vscode.OutputChannel {
        return this.channel;
    }

    showTerminalOutput(): void {
        this.channel.show(true);
    }

    async run(command: string, cwd: string, timeoutMs = 120000, signal?: AbortSignal): Promise<RunResult> {
        const started = Date.now();
        this.channel.appendLine(`\n$ ${command}   (cwd: ${cwd})`);

        return new Promise<RunResult>((resolve) => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let finished = false;

            const child = spawn(command, {
                cwd,
                shell: true,
                windowsHide: true,
                env: { ...process.env, FORCE_COLOR: '0', CI: '1' }
            });

            const timer = setTimeout(() => {
                timedOut = true;
                this.killTree(child);
            }, Math.max(5000, timeoutMs));

            const onAbort = () => this.killTree(child);
            signal?.addEventListener('abort', onAbort, { once: true });

            child.stdout?.on('data', (d: Buffer) => {
                const s = stripAnsi(d.toString());
                stdout += s;
                this.channel.append(s);
            });
            child.stderr?.on('data', (d: Buffer) => {
                const s = stripAnsi(d.toString());
                stderr += s;
                this.channel.append(s);
            });

            const done = (code: number | null) => {
                if (finished) { return; }
                finished = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                this.channel.appendLine(`\n[exit ${code}${timedOut ? ', timed out' : ''}]`);
                resolve({
                    command,
                    code,
                    stdout: stripAnsi(stdout),
                    stderr: stripAnsi(stderr),
                    timedOut,
                    durationMs: Date.now() - started
                });
            };

            child.on('error', (err) => {
                stderr += `\n${err.message}`;
                done(null);
            });
            child.on('close', (code) => done(code));
        });
    }

    /** Start a long-running process (dev server) and track it. */
    start(command: string, cwd: string, id?: string): ServerHandle {
        const key = id || `server-${Date.now()}`;
        this.channel.appendLine(`\n$ ${command}   (long-running, id=${key})`);

        const child = spawn(command, {
            cwd,
            shell: true,
            windowsHide: true,
            detached: process.platform !== 'win32',
            env: { ...process.env, FORCE_COLOR: '0' }
        });

        const handle: ServerHandle = {
            id: key,
            command,
            child,
            startedAt: Date.now(),
            output: '',
            running: true
        };

        const capture = (d: Buffer) => {
            const s = stripAnsi(d.toString());
            handle.output = tail(handle.output + s, 40000);
            this.channel.append(s);
            if (!handle.url) {
                const m = s.match(URL_RE);
                if (m) { handle.url = m[1].replace(/[),.;]+$/, ''); }
            }
        };

        child.stdout?.on('data', capture);
        child.stderr?.on('data', capture);
        child.on('close', (code) => {
            handle.running = false;
            this.channel.appendLine(`\n[${key} exited ${code}]`);
        });

        this.servers.set(key, handle);
        return handle;
    }

    stop(id: string): boolean {
        const h = this.servers.get(id);
        if (!h) { return false; }
        this.killTree(h.child);
        h.running = false;
        return true;
    }

    stopAll(): string[] {
        const ids: string[] = [];
        for (const [id, h] of this.servers) {
            this.killTree(h.child);
            h.running = false;
            ids.push(id);
        }
        return ids;
    }

    list(): Array<{ id: string; command: string; running: boolean; url?: string; output: string }> {
        return [...this.servers.values()].map((s) => ({
            id: s.id,
            command: s.command,
            running: s.running,
            url: s.url,
            output: tail(s.output, 4000)
        }));
    }

    get(id: string): ServerHandle | undefined {
        return this.servers.get(id);
    }

    private killTree(child: ChildProcess): void {
        if (!child || child.killed) { return; }
        try {
            if (process.platform === 'win32' && child.pid) {
                spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            } else if (child.pid) {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
            }
        } catch { /* best effort */ }
    }
}

export function guessOpenCommand(url: string): string {
    // reserved for future "open in browser" integration
    return url;
}

export function cwdFor(root: string, sub?: string): string {
    if (!sub) { return root; }
    return path.isAbsolute(sub) ? sub : path.join(root, sub);
}
