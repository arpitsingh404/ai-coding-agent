/**
 * Pure glob / ignore helpers (no vscode import - unit tested).
 */

/** Convert a glob to an anchored RegExp. Supports **, *, ?, {a,b}. */
export function globToRegExp(glob: string): RegExp {
    let g = glob.trim().replace(/\\/g, '/');
    if (!g) { return /^$/; }

    let out = '';
    let i = 0;
    while (i < g.length) {
        const c = g[i];
        if (c === '*') {
            if (g[i + 1] === '*') {
                // ** matches across separators
                out += '.*';
                i += 2;
                if (g[i] === '/') { i++; }
            } else {
                out += '[^/]*';
                i++;
            }
        } else if (c === '?') {
            out += '[^/]';
            i++;
        } else if (c === '{') {
            const end = g.indexOf('}', i);
            if (end > -1) {
                const parts = g.slice(i + 1, end).split(',').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                out += '(' + parts.join('|') + ')';
                i = end + 1;
            } else {
                out += '\\{';
                i++;
            }
        } else {
            out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            i++;
        }
    }
    return new RegExp('^' + out + '$');
}

export class GlobSet {
    private readonly matchers: RegExp[];

    constructor(globs: string[]) {
        this.matchers = (globs || []).map(globToRegExp);
    }

    matches(relPath: string): boolean {
        const p = relPath.replace(/\\/g, '/');
        return this.matchers.some((m) => m.test(p));
    }
}

/** Very small .gitignore parser - the common subset only. */
export class GitIgnore {
    private readonly rules: Array<{ re: RegExp; negate: boolean }> = [];

    constructor(content: string) {
        for (const raw of content.split(/\r?\n/)) {
            let line = raw.trim();
            if (!line || line.startsWith('#')) { continue; }
            let negate = false;
            if (line.startsWith('!')) { negate = true; line = line.slice(1); }
            const dirOnly = line.endsWith('/');
            if (dirOnly) { line = line.slice(0, -1); }
            const anchored = line.startsWith('/');
            if (anchored) { line = line.slice(1); }
            if (!line) { continue; }
            // Escape regex chars except glob ones
            let body = '';
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '*') {
                    if (line[i + 1] === '*') { body += '.*'; i++; }
                    else { body += '[^/]*'; }
                } else if (c === '?') {
                    body += '[^/]';
                } else {
                    body += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                }
            }
            const prefix = anchored ? '^' : '(^|.*/)';
            const suffix = dirOnly ? '(/.*)?$' : '(/.*)?$';
            this.rules.push({ re: new RegExp(prefix + body + suffix), negate });
        }
    }

    ignores(relPath: string): boolean {
        const p = relPath.replace(/\\/g, '/');
        let ignored = false;
        for (const r of this.rules) {
            if (r.re.test(p)) {
                ignored = !r.negate;
            }
        }
        return ignored;
    }
}

/**
 * Score a file against a natural-language task so we send relevant context only.
 */
export function relevanceScore(relPath: string, task: string): number {
    const p = relPath.toLowerCase();
    const words = (task || '')
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((w) => w.length > 2)
        .filter((w) => !STOP.has(w));

    let score = 0;
    for (const w of words) {
        if (p.includes(w)) {
            score += 6;
            // stronger when the filename itself contains the word
            const base = p.split('/').pop() || '';
            if (base.includes(w)) { score += 4; }
        }
    }
    if (/(^|\/)(package\.json|tsconfig\.json|pyproject\.toml|go\.mod|cargo\.toml|requirements\.txt)$/.test(p)) { score += 3; }
    if (/(^|\/)(readme\.md|readme)$/.test(p)) { score += 2; }
    if (/\.(ts|tsx|js|jsx|py|go|rs|java|php|vue|svelte)$/.test(p)) { score += 2; }
    if (/(^|\/)(main|index|app|server|extension)\.[a-z]+$/.test(p)) { score += 3; }
    return score;
}

const STOP = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'into', 'your',
    'please', 'make', 'create', 'add', 'build', 'code', 'file', 'files', 'project',
    'karo', 'kar', 'mujhe', 'mera', 'mere', 'hai', 'hain', 'koi', 'ek', 'aur', 'banao'
]);
