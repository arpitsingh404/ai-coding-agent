import * as vscode from 'vscode';

export interface ChangeRecord {
    rel: string;
    before: string | null;   // null = file was created
    after: string;
    at: number;
    kind: 'create' | 'edit' | 'delete';
}

/**
 * Keeps a bounded in-memory history of agent-made changes so the user can undo.
 * Real file contents are read lazily before a change is applied.
 */
export class ChangeTracker {
    private readonly history: ChangeRecord[] = [];
    private readonly limit = 100;

    constructor(private readonly read: (rel: string) => Promise<string | null>) {}

    async snapshot(rel: string): Promise<string | null> {
        try {
            return await this.read(rel);
        } catch {
            return null;
        }
    }

    record(rec: Omit<ChangeRecord, 'at'>): void {
        this.history.push({ ...rec, at: Date.now() });
        if (this.history.length > this.limit) {
            this.history.shift();
        }
    }

    last(): ChangeRecord | undefined {
        return this.history[this.history.length - 1];
    }

    recent(n = 20): ChangeRecord[] {
        return this.history.slice(-n).reverse();
    }

    changedFiles(): string[] {
        return [...new Set(this.history.map((h) => h.rel))];
    }

    /** Revert the most recent change. Returns a human-readable result. */
    async undoLast(write: (rel: string, content: string) => Promise<void>, remove: (rel: string) => Promise<void>): Promise<string> {
        const rec = this.history.pop();
        if (!rec) { return 'Nothing to undo.'; }
        try {
            if (rec.kind === 'create') {
                await remove(rec.rel);
                return `Removed ${rec.rel} (created by agent).`;
            }
            if (rec.before === null) {
                await remove(rec.rel);
                return `Removed ${rec.rel}.`;
            }
            await write(rec.rel, rec.before);
            return `Restored ${rec.rel} to its previous contents.`;
        } catch (e: any) {
            return `Undo failed for ${rec.rel}: ${e?.message ?? e}`;
        }
    }

    async showDiff(rec: ChangeRecord, label = 'before'): Promise<void> {
        const left = DiffContentProvider.makeUri(`${rec.rel} (${label})`, rec.before ?? '');
        const right = DiffContentProvider.makeUri(`${rec.rel} (after)`, rec.after);
        await vscode.commands.executeCommand('vscode.diff', left, right, `${rec.rel} — agent change`);
    }
}

/** Provides both sides of agent diffs from an in-memory store (no size limits). */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'ai-agent-diff';
    private static instance: DiffContentProvider | undefined;
    private readonly store = new Map<string, string>();
    private seq = 0;

    constructor() {
        DiffContentProvider.instance = this;
    }

    static makeUri(label: string, content: string): vscode.Uri {
        const inst = DiffContentProvider.instance;
        const id = inst ? `d${inst.seq++}` : `d${Date.now()}`;
        if (inst) { inst.set(id, content); }
        return vscode.Uri.parse(`${DiffContentProvider.scheme}:${encodeURIComponent(label)}?id=${id}`);
    }

    provideTextDocumentContent(uri: vscode.Uri, _token: vscode.CancellationToken): string {
        const id = new URLSearchParams(uri.query).get('id') ?? '';
        return this.store.get(id) ?? '';
    }

    set(id: string, content: string): void {
        this.store.set(id, content);
    }

    clear(): void {
        this.store.clear();
    }
}
