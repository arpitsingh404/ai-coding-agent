import * as path from 'path';
import { AgentConfig } from '../config/settings';
import { GlobSet, GitIgnore, relevanceScore } from './ignore';
import { WorkspaceFiles } from '../workspace/files';
import { isProbablyText } from '../workspace/pathGuard';

export interface ContextBundle {
    text: string;
    files: string[];
    bytes: number;
}

/**
 * Builds a compact project context: structure + the most relevant files only.
 * Never sends the whole workspace, never sends secrets or ignored paths.
 */
export class ContextBuilder {
    constructor(private readonly files: WorkspaceFiles) {}

    async build(task: string, cfg: AgentConfig, extraFiles: string[] = []): Promise<ContextBundle> {
        const all = await this.files.listFiles(3000);
        const exclude = new GlobSet(cfg.excludeGlobs || []);
        const secret = new GlobSet(cfg.secretFilePatterns || []);

        const eligible = all.filter((f) =>
            !exclude.matches(f.rel) &&
            !secret.matches(f.rel) &&
            !this.files.isSecret(f.rel) &&
            isProbablyText(path.extname(f.rel))
        );

        const scored = eligible
            .map((f) => ({ f, score: relevanceScore(f.rel, task) }))
            .sort((a, b) => b.score - a.score);

        const picked: Array<{ rel: string; content: string }> = [];
        let bytes = 0;
        const seen = new Set<string>();

        const tryAdd = async (rel: string, extraBudget = 0) => {
            if (seen.has(rel) || picked.length >= cfg.maxContextFiles) { return; }
            const entry = eligible.find((e) => e.rel === rel);
            if (!entry || entry.size > 120_000) { return; }
            try {
                const content = await this.files.readText(rel);
                const size = Buffer.byteLength(content, 'utf8');
                if (bytes + size > cfg.maxContextBytes + extraBudget) { return; }
                picked.push({ rel, content });
                seen.add(rel);
                bytes += size;
            } catch { /* skip unreadable */ }
        };

        for (const rel of extraFiles) { await tryAdd(rel); }
        for (const s of scored) {
            if (picked.length >= cfg.maxContextFiles) { break; }
            await tryAdd(s.f.rel);
        }

        const structure = eligible.slice(0, 300).map((f) => f.rel).join('\n');
        const parts: string[] = [];

        parts.push('## Project structure (relevant paths)\n```\n' + structure + '\n```');
        for (const p of picked) {
            parts.push(`## File: ${p.rel}\n\`\`\`${langFor(p.rel)}\n${p.content}\n\`\`\``);
        }
        if (!picked.length) {
            parts.push('(No specific files matched. Ask the user or use list_files / search_files.)');
        }

        return {
            text: parts.join('\n\n'),
            files: picked.map((p) => p.rel),
            bytes
        };
    }
}

function langFor(rel: string): string {
    const ext = path.extname(rel).toLowerCase().replace('.', '');
    const map: Record<string, string> = {
        ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'python', rb: 'ruby',
        go: 'go', rs: 'rust', java: 'java', php: 'php', html: 'html', css: 'css',
        json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash',
        sql: 'sql', vue: 'vue', svelte: 'svelte'
    };
    return map[ext] ?? ext;
}
