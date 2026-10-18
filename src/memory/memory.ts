import type * as vscode from 'vscode';
import { randomBytes } from 'crypto';

export interface MemoryEntry {
    id: string;
    text: string;
    tags: string[];
    createdAt: number;
    /** 'global' = all workspaces, 'workspace' = tied to the current folder */
    scope: 'global' | 'workspace';
}

const KEY = 'aiCodingAgent.memory';
const MAX_ENTRIES = 250;

/**
 * Persistent agent memory.
 * Stored in globalState (encrypted-at-rest by VS Code's storage) so it survives
 * window reloads and works across projects.
 */
export class MemoryStore {
    constructor(
        private readonly ctx: vscode.ExtensionContext,
        private readonly root: () => string
    ) {}

    all(): MemoryEntry[] {
        const raw = this.ctx.globalState.get<MemoryEntry[]>(KEY);
        return Array.isArray(raw) ? raw : [];
    }

    private save(list: MemoryEntry[]): Thenable<void> {
        return this.ctx.globalState.update(KEY, list.slice(-MAX_ENTRIES));
    }

    add(text: string, tags: string[] = [], scope: 'global' | 'workspace' = 'global'): MemoryEntry {
        const clean = (text ?? '').trim();
        if (!clean) { throw new Error('Memory text is empty.'); }
        const list = this.all();

        // de-dupe identical text
        const existing = list.find((m) => m.text.toLowerCase() === clean.toLowerCase());
        if (existing) {
            existing.createdAt = Date.now();
            void this.save(list);
            return existing;
        }

        const entry: MemoryEntry = {
            id: randomBytes(4).toString('hex'),
            text: clean.slice(0, 2000),
            tags: (tags || []).map((t) => String(t).toLowerCase()).slice(0, 8),
            createdAt: Date.now(),
            scope
        };
        list.push(entry);
        void this.save(list);
        return entry;
    }

    remove(id: string): boolean {
        const list = this.all();
        const next = list.filter((m) => m.id !== id);
        if (next.length === list.length) { return false; }
        void this.save(next);
        return true;
    }

    clear(): void {
        void this.save([]);
    }

    /** Keyword-scored search. Empty query returns the newest entries. */
    search(query: string, limit = 8): MemoryEntry[] {
        const list = this.all();
        const q = (query ?? '').toLowerCase().trim();
        if (!q) { return list.slice(-limit).reverse(); }

        const words = q.split(/[^a-z0-9_.-]+/).filter((w) => w.length > 2);
        const scored = list.map((m) => {
            const hay = (m.text + ' ' + m.tags.join(' ')).toLowerCase();
            let score = 0;
            for (const w of words) {
                if (hay.includes(w)) { score += 3; }
            }
            // recency bonus
            const ageDays = (Date.now() - m.createdAt) / 86_400_000;
            score += Math.max(0, 2 - ageDays / 30);
            return { m, score };
        });

        return scored
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((s) => s.m);
    }

    /** Compact block injected into the system prompt. */
    relevantBlock(task: string, limit = 6): string {
        const hits = this.search(task, limit);
        if (!hits.length) { return ''; }
        return hits
            .map((m) => `- ${m.text}${m.tags.length ? '  _(tags: ' + m.tags.join(', ') + ')_' : ''}`)
            .join('\n');
    }
}
