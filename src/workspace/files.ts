import * as vscode from 'vscode';
import * as path from 'path';
import { AgentConfig } from '../config/settings';
import { GlobSet, GitIgnore } from '../context/ignore';
import { isProbablyText, looksBinary, normalise, resolveInsideWorkspace } from './pathGuard';
import { detectCommands, ProjectCommands } from '../security/commandGuard';

export interface FileEntry {
    rel: string;
    size: number;
}

export interface ProjectInfo {
    root: string;
    rootName: string;
    totalFiles: number;
    topLevel: string[];
    packageJson?: any;
    commands: ProjectCommands;
    languages: string[];
    gitRepo: boolean;
}

const MAX_READ_BYTES = 400_000;

export class WorkspaceFiles {
    constructor(private cfg: () => AgentConfig) {}

    root(): string {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || !folders.length) { return ''; }
        return folders[0].uri.fsPath;
    }

    private excludeSet(): GlobSet {
        return new GlobSet(this.cfg().excludeGlobs || []);
    }

    private secretSet(): GlobSet {
        return new GlobSet(this.cfg().secretFilePatterns || []);
    }

    isSecret(rel: string): boolean {
        const p = normalise(rel).toLowerCase();
        const base = p.split('/').pop() || '';
        if (base === '.env' || base.startsWith('.env.')) { return true; }
        if (/\.(pem|key|p12|pfx|keystore|jks)$/.test(base)) { return true; }
        if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(base)) { return true; }
        return this.secretSet().matches(p);
    }

    resolve(relOrAbs: string) {
        return resolveInsideWorkspace(this.root(), relOrAbs);
    }

    async listFiles(limit = 4000): Promise<FileEntry[]> {
        const root = this.root();
        if (!root) { return []; }
        const cfg = this.cfg();
        const exclude = this.excludeSet();
        const secret = this.secretSet();

        let gitignore: GitIgnore | undefined;
        try {
            const gi = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.file(root), '.gitignore'));
            gitignore = new GitIgnore(Buffer.from(gi).toString('utf8'));
        } catch { /* no .gitignore */ }

        const uris = await vscode.workspace.findFiles('**/*', undefined, limit);
        const out: FileEntry[] = [];
        for (const uri of uris) {
            const rel = path.relative(root, uri.fsPath).replace(/\\/g, '/');
            if (!rel || rel.startsWith('..')) { continue; }
            if (exclude.matches(rel) || secret.matches(rel) || this.isSecret(rel)) { continue; }
            if (gitignore && gitignore.ignores(rel)) { continue; }
            let size = 0;
            try { size = (await vscode.workspace.fs.stat(uri)).size; } catch { /* skip */ }
            if (size > 0 && !isProbablyText(path.extname(rel))) { continue; }
            out.push({ rel, size });
            if (out.length >= limit) { break; }
        }
        return out;
    }

    async readText(relOrAbs: string, startLine?: number, endLine?: number): Promise<string> {
        const check = this.resolve(relOrAbs);
        if (!check.ok || !check.resolved) {
            throw new Error(check.reason || 'Invalid path');
        }
        if (this.isSecret(check.relative || '')) {
            throw new Error(`Refusing to read secret file: ${check.relative}`);
        }
        const uri = vscode.Uri.file(check.resolved);
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_READ_BYTES) {
            throw new Error(`File too large (${Math.round(stat.size / 1024)} KB). Read a slice with startLine/endLine.`);
        }
        const buf = Buffer.from(await vscode.workspace.fs.readFile(uri));
        if (looksBinary(buf)) {
            throw new Error('Binary file - not readable as text.');
        }
        const text = buf.toString('utf8');
        if (startLine === undefined && endLine === undefined) {
            return text;
        }
        const lines = text.split(/\r?\n/);
        const s = Math.max(0, (startLine ?? 1) - 1);
        const e = Math.min(lines.length, endLine ?? lines.length);
        return lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join('\n');
    }

    async exists(relOrAbs: string): Promise<boolean> {
        const check = this.resolve(relOrAbs);
        if (!check.ok || !check.resolved) { return false; }
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(check.resolved));
            return true;
        } catch {
            return false;
        }
    }

    /** Fully write a file (creates parents). Returns the relative path. */
    async writeText(relOrAbs: string, content: string): Promise<string> {
        const check = this.resolve(relOrAbs);
        if (!check.ok || !check.resolved || !check.relative) {
            throw new Error(check.reason || 'Invalid path');
        }
        const uri = vscode.Uri.file(check.resolved);
        const dir = vscode.Uri.file(path.dirname(check.resolved));
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        return check.relative;
    }

    /** Targeted replacement - fails loudly when the anchor is missing/ambiguous. */
    async replaceInFile(relOrAbs: string, oldText: string, newText: string, replaceAll = false): Promise<{ rel: string; occurrences: number }> {
        const check = this.resolve(relOrAbs);
        if (!check.ok || !check.resolved || !check.relative) {
            throw new Error(check.reason || 'Invalid path');
        }
        const uri = vscode.Uri.file(check.resolved);
        const buf = Buffer.from(await vscode.workspace.fs.readFile(uri));
        const text = buf.toString('utf8');

        if (!oldText) { throw new Error('old_string must not be empty. Use write_file for new files.'); }
        const occurrences = countOccurrences(text, oldText);
        if (occurrences === 0) {
            throw new Error('old_string not found in file. Read the file again and copy the exact text.');
        }
        if (occurrences > 1 && !replaceAll) {
            throw new Error(`old_string appears ${occurrences} times. Add more surrounding context or pass replace_all=true.`);
        }
        const updated = replaceAll
            ? text.split(oldText).join(newText)
            : text.replace(oldText, newText);

        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
        return { rel: check.relative, occurrences };
    }

    async deleteFile(relOrAbs: string): Promise<string> {
        const check = this.resolve(relOrAbs);
        if (!check.ok || !check.resolved || !check.relative) {
            throw new Error(check.reason || 'Invalid path');
        }
        await vscode.workspace.fs.delete(vscode.Uri.file(check.resolved), { recursive: false, useTrash: true });
        return check.relative;
    }

    async search(query: string, maxResults = 60): Promise<Array<{ file: string; line: number; text: string }>> {
        const q = (query || '').trim();
        if (!q) { return []; }
        const files = await this.listFiles(2000);
        const results: Array<{ file: string; line: number; text: string }> = [];
        const needle = q.toLowerCase();
        for (const f of files) {
            if (results.length >= maxResults) { break; }
            if (f.size > MAX_READ_BYTES) { continue; }
            let text = '';
            try {
                text = await this.readText(f.rel);
            } catch { continue; }
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(needle)) {
                    results.push({ file: f.rel, line: i + 1, text: lines[i].slice(0, 240) });
                    if (results.length >= maxResults) { break; }
                }
            }
        }
        return results;
    }

    async projectInfo(): Promise<ProjectInfo> {
        const root = this.root();
        const files = await this.listFiles(3000);
        let packageJson: any | undefined;
        try {
            const raw = await this.readText('package.json');
            packageJson = JSON.parse(raw);
        } catch { /* not a node project */ }

        const topLevel = [...new Set(files.map((f) => f.rel.split('/')[0]))].slice(0, 60);
        const extCount = new Map<string, number>();
        for (const f of files) {
            const ext = path.extname(f.rel).toLowerCase();
            if (!ext) { continue; }
            extCount.set(ext, (extCount.get(ext) || 0) + 1);
        }
        const languages = [...extCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([e, n]) => `${e}(${n})`);

        let gitRepo = false;
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(path.join(root, '.git')));
            gitRepo = true;
        } catch { /* ignore */ }

        return {
            root,
            rootName: path.basename(root),
            totalFiles: files.length,
            topLevel,
            packageJson,
            commands: detectCommands(files.map((f) => f.rel), packageJson),
            languages,
            gitRepo
        };
    }
}

function countOccurrences(haystack: string, needle: string): number {
    if (!needle) { return 0; }
    let count = 0;
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        count++;
        idx += needle.length;
    }
    return count;
}
