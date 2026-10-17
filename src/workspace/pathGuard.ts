/**
 * Pure path-safety helpers (no vscode import - unit tested).
 */
import * as path from 'path';

export interface PathCheck {
    ok: boolean;
    resolved?: string;
    relative?: string;
    reason?: string;
}

/** Normalise slashes and strip leading ./ */
export function normalise(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Resolve `candidate` inside `root` and refuse anything that escapes it.
 */
export function resolveInsideWorkspace(root: string, candidate: string): PathCheck {
    if (!root) {
        return { ok: false, reason: 'No workspace folder is open.' };
    }
    if (!candidate || typeof candidate !== 'string') {
        return { ok: false, reason: 'Empty path.' };
    }
    const cleaned = candidate.replace(/^file:\/\//i, '');
    const abs = path.isAbsolute(cleaned)
        ? path.normalize(cleaned)
        : path.resolve(root, cleaned);

    const rel = path.relative(root, abs);
    if (rel === '') {
        return { ok: true, resolved: abs, relative: '.' };
    }
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { ok: false, reason: `Path escapes the workspace: ${candidate}` };
    }
    return { ok: true, resolved: abs, relative: rel.replace(/\\/g, '/') };
}

/** Refuse obviously binary / huge files as text context. */
export function looksBinary(buf: Buffer): boolean {
    const n = Math.min(buf.length, 8000);
    for (let i = 0; i < n; i++) {
        if (buf[i] === 0) { return true; }
    }
    return false;
}

const TEXT_EXT = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.mdx',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs',
    '.php', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
    '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh',
    '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.gql', '.xml', '.svg', '.txt',
    '.gitignore', '.env.example', '.editorconfig', '.dockerfile', '.prisma', '.astro'
]);

export function isProbablyText(ext: string): boolean {
    const e = ext.toLowerCase();
    if (!e) { return true; }
    return TEXT_EXT.has(e);
}
