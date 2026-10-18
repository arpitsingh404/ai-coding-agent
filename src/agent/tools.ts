import * as vscode from 'vscode';
import { ToolSpec } from '../providers/types';
import { AgentConfig } from '../config/settings';
import { WorkspaceFiles } from '../workspace/files';
import { ChangeTracker } from '../workspace/changes';
import { CommandRunner, tail } from '../terminal/runner';
import { collectDiagnostics } from '../debug/diagnostics';
import { analyseCommand } from '../security/commandGuard';
import { describeChange, diffToMarkdown } from '../util/diff';
import { MemoryStore } from '../memory/memory';

export interface PlanStep {
    title: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ApprovalRequest {
    kind: 'write' | 'edit' | 'delete' | 'command';
    title: string;
    detail: string;
    preview?: string;
    risk?: 'low' | 'medium' | 'high';
    command?: string;
}

export interface ToolContext {
    root: string;
    cfg: AgentConfig;
    files: WorkspaceFiles;
    runner: CommandRunner;
    tracker: ChangeTracker;
    memory: MemoryStore;
    token: { isCancellationRequested: boolean };
    approve(req: ApprovalRequest): Promise<boolean>;
    onPlan(steps: PlanStep[]): void;
    onActivity(activity: string): void;
    onDiff(rel: string, before: string | null, after: string): void;
    confirmQuestion(question: string): Promise<string | undefined>;
}

export const TOOL_SPECS: ToolSpec[] = [
    {
        name: 'list_files',
        description: 'List project files (respects .gitignore and excludes). Use a glob to narrow, e.g. "src/**/*.ts".',
        parameters: {
            type: 'object',
            properties: {
                glob: { type: 'string', description: 'Optional glob filter, e.g. src/**/*.tsx' },
                limit: { type: 'number', description: 'Max files to return (default 200)' }
            }
        }
    },
    {
        name: 'read_file',
        description: 'Read a text file from the workspace. Always read before editing. Use line ranges for large files.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative path, e.g. src/app.ts' },
                start_line: { type: 'number' },
                end_line: { type: 'number' }
            },
            required: ['path']
        }
    },
    {
        name: 'search_files',
        description: 'Case-insensitive text search across project files. Returns file:line matches.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                max_results: { type: 'number' }
            },
            required: ['query']
        }
    },
    {
        name: 'write_file',
        description: 'Create a file or overwrite it completely. For small edits prefer apply_edit. Requires user approval.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                content: { type: 'string' },
                reason: { type: 'string', description: 'One line explaining why this change is needed' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'apply_edit',
        description: 'Replace an exact snippet in an existing file. old_string must match the file exactly and be unique unless replace_all is true. Requires user approval.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                old_string: { type: 'string' },
                new_string: { type: 'string' },
                replace_all: { type: 'boolean' },
                reason: { type: 'string' }
            },
            required: ['path', 'old_string', 'new_string']
        }
    },
    {
        name: 'delete_file',
        description: 'Delete a single file (moved to trash). Requires explicit user approval.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, reason: { type: 'string' } },
            required: ['path']
        }
    },
    {
        name: 'run_command',
        description: 'Run a shell command in the workspace and capture stdout/stderr. Requires user approval unless auto-approved. Never use for destructive commands.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string' },
                cwd: { type: 'string', description: 'Optional subdirectory of the workspace' },
                timeout_ms: { type: 'number' }
            },
            required: ['command']
        }
    },
    {
        name: 'start_server',
        description: 'Start a long-running process such as a dev server. Returns an id you can use with stop_server. Prefer this over run_command for "npm run dev".',
        parameters: {
            type: 'object',
            properties: { command: { type: 'string' }, cwd: { type: 'string' } },
            required: ['command']
        }
    },
    {
        name: 'stop_server',
        description: 'Stop a previously started long-running process.',
        parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id']
        }
    },
    {
        name: 'get_diagnostics',
        description: 'Read VS Code Problems (errors/warnings) for the workspace or a single file.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' } }
        }
    },
    {
        name: 'get_project_info',
        description: 'Detect framework, package manager and the right install/dev/build/test commands. Call this before running anything.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'update_plan',
        description: 'Publish or update the task plan shown to the user. Use for multi-step work.',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] }
                        },
                        required: ['title', 'status']
                    }
                }
            },
            required: ['steps']
        }
    },
    {
        name: 'ask_user',
        description: 'Ask the user a direct question when a decision is genuinely ambiguous. Do not use for trivial choices.',
        parameters: {
            type: 'object',
            properties: { question: { type: 'string' } },
            required: ['question']
        }
    },
    {
        name: 'remember',
        description: 'Store a durable fact about the user or this project (preferences, stack, conventions, credentials-free context). Use it whenever the user states something that should still be true in future sessions.',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Short, self-contained statement, e.g. "User prefers TypeScript + Tailwind and Hinglish replies".' },
                tags: { type: 'array', items: { type: 'string' } }
            },
            required: ['text']
        }
    },
    {
        name: 'recall',
        description: 'Search your persistent memory for facts relevant to the current task.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string' } }
        }
    },
    {
        name: 'forget',
        description: 'Delete a memory entry by id (use recall first to find the id).',
        parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id']
        }
    }
];

function str(v: unknown, fallback = ''): string {
    return typeof v === 'string' ? v : fallback;
}
function num(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    switch (name) {
        case 'list_files': {
            ctx.onActivity('Listing files');
            const glob = str(args.glob).trim();
            const limit = num(args.limit) ?? 200;
            const all = await ctx.files.listFiles(3000);
            let rows = all.map((f) => f.rel);
            if (glob) {
                const { globToRegExp } = await import('../context/ignore');
                const re = globToRegExp(glob);
                rows = rows.filter((r) => re.test(r));
            }
            if (!rows.length) { return 'No files matched.'; }
            return `Files (${rows.length}):\n` + rows.slice(0, limit).join('\n');
        }

        case 'read_file': {
            const p = str(args.path);
            ctx.onActivity(`Reading ${p}`);
            const text = await ctx.files.readText(p, num(args.start_line), num(args.end_line));
            return text;
        }

        case 'search_files': {
            const q = str(args.query);
            ctx.onActivity(`Searching "${q}"`);
            const res = await ctx.files.search(q, num(args.max_results) ?? 60);
            if (!res.length) { return `No matches for "${q}".`; }
            return res.map((r) => `${r.file}:${r.line}: ${r.text}`).join('\n');
        }

        case 'write_file': {
            const p = str(args.path);
            const content = str(args.content);
            const reason = str(args.reason);
            if (!p) { return 'ERROR: path is required.'; }

            const before = await ctx.tracker.snapshot(p);
            if (ctx.cfg.requireApprovalForEdits) {
                const ok = await ctx.approve({
                    kind: 'write',
                    title: `${before === null ? 'Create' : 'Overwrite'} ${p}`,
                    detail: `${describeChange(before, content)}${reason ? ' â€” ' + reason : ''}`,
                    preview: diffToMarkdown(before ?? '', content),
                    risk: before === null ? 'low' : 'medium'
                });
                if (!ok) { return 'REJECTED: user declined this change.'; }
            }

            const rel = await ctx.files.writeText(p, content);
            ctx.tracker.record({ rel, before, after: content, kind: before === null ? 'create' : 'edit' });
            ctx.onDiff(rel, before, content);
            return `Wrote ${rel} (${content.split(/\r?\n/).length} lines).`;
        }

        case 'apply_edit': {
            const p = str(args.path);
            const oldS = str(args.old_string);
            const newS = str(args.new_string);
            const replaceAll = args.replace_all === true;
            const reason = str(args.reason);
            if (!p) { return 'ERROR: path is required.'; }

            const before = await ctx.tracker.snapshot(p);
            if (before === null) {
                return `ERROR: ${p} does not exist. Use write_file to create it.`;
            }
            if (!oldS) { return 'ERROR: old_string is required for apply_edit.'; }

            // Simulate the change locally first so we can preview it accurately
            const occurrences = countOccurrences(before, oldS);
            if (occurrences === 0) {
                return 'ERROR: old_string not found. Read the file again and copy the exact snippet.';
            }
            if (occurrences > 1 && !replaceAll) {
                return `ERROR: old_string appears ${occurrences} times. Include more context or set replace_all=true.`;
            }
            const after = replaceAll ? before.split(oldS).join(newS) : before.replace(oldS, newS);

            if (ctx.cfg.requireApprovalForEdits) {
                const ok = await ctx.approve({
                    kind: 'edit',
                    title: `Edit ${p}`,
                    detail: `${describeChange(before, after)}${reason ? ' â€” ' + reason : ''}`,
                    preview: diffToMarkdown(before, after),
                    risk: 'medium'
                });
                if (!ok) { return 'REJECTED: user declined this edit.'; }
            }

            const res = await ctx.files.replaceInFile(p, oldS, newS, replaceAll);
            ctx.tracker.record({ rel: res.rel, before, after, kind: 'edit' });
            ctx.onDiff(res.rel, before, after);
            return `Edited ${res.rel} (${occurrences} occurrence${occurrences > 1 ? 's' : ''} replaced).`;
        }

        case 'delete_file': {
            const p = str(args.path);
            const reason = str(args.reason);
            if (ctx.cfg.requireApprovalForEdits) {
                const ok = await ctx.approve({
                    kind: 'delete',
                    title: `Delete ${p}`,
                    detail: reason || 'File will be moved to the recycle bin.',
                    risk: 'high'
                });
                if (!ok) { return 'REJECTED: user declined the delete.'; }
            }
            const before = await ctx.tracker.snapshot(p);
            const rel = await ctx.files.deleteFile(p);
            ctx.tracker.record({ rel, before, after: '', kind: 'delete' });
            return `Deleted ${rel}.`;
        }

        case 'run_command': {
            const command = str(args.command).trim();
            if (!command) { return 'ERROR: command is required.'; }

            const verdict = analyseCommand(command, ctx.cfg.commandPolicy);
            if (verdict.blocked) {
                return `BLOCKED by safety policy: ${verdict.reason}`;
            }

            const needApproval = ctx.cfg.requireApprovalForCommands && verdict.risk !== 'low';
            if (needApproval) {
                const ok = await ctx.approve({
                    kind: 'command',
                    title: `Run command`,
                    detail: command,
                    command,
                    risk: verdict.risk
                });
                if (!ok) { return 'REJECTED: user declined to run the command.'; }
            }

            ctx.onActivity(`Running: ${command}`);
            const timeout = num(args.timeout_ms) ?? ctx.cfg.commandTimeoutMs;
            const cwd = args.cwd ? str(args.cwd) : ctx.root;
            const res = await ctx.runner.run(command, cwd, Math.min(timeout, 600000));

            const parts = [
                `exit_code: ${res.code}${res.timedOut ? ' (timed out)' : ''}`,
                `duration_ms: ${res.durationMs}`,
                res.stdout ? 'stdout:\n' + tail(res.stdout, 10000) : '',
                res.stderr ? 'stderr:\n' + tail(res.stderr, 6000) : ''
            ].filter(Boolean);
            return parts.join('\n\n');
        }

        case 'start_server': {
            const command = str(args.command).trim();
            if (!command) { return 'ERROR: command is required.'; }
            const verdict = analyseCommand(command, ctx.cfg.commandPolicy);
            if (verdict.blocked) { return `BLOCKED: ${verdict.reason}`; }

            if (ctx.cfg.requireApprovalForCommands) {
                const ok = await ctx.approve({ kind: 'command', title: 'Start long-running process', detail: command, command, risk: verdict.risk });
                if (!ok) { return 'REJECTED: user declined.'; }
            }
            const cwd = args.cwd ? str(args.cwd) : ctx.root;
            const h = ctx.runner.start(command, cwd);
            await new Promise((r) => setTimeout(r, 2500));
            const out = ctx.runner.list().find((s) => s.id === h.id);
            return `Started id=${h.id}\nurl: ${out?.url ?? 'not detected yet'}\noutput:\n${out?.output ?? ''}`;
        }

        case 'stop_server': {
            const id = str(args.id);
            const ok = ctx.runner.stop(id);
            return ok ? `Stopped ${id}.` : `No such process: ${id}`;
        }

        case 'get_diagnostics': {
            ctx.onActivity('Reading Problems');
            const only = str(args.path) || undefined;
            const d = collectDiagnostics(ctx.root, only);
            if (!d.items.length) { return 'No diagnostics. Project is clean.'; }
            return `errors=${d.errors} warnings=${d.warnings}\n` +
                d.items.map((i) => `${i.severity} ${i.file}:${i.line} â€” ${i.message}`).join('\n');
        }

        case 'get_project_info': {
            ctx.onActivity('Analysing project');
            const info = await ctx.files.projectInfo();
            return JSON.stringify({
                root: info.rootName,
                files: info.totalFiles,
                languages: info.languages,
                topLevel: info.topLevel,
                git: info.gitRepo,
                commands: info.commands,
                framework: detectFramework(info.packageJson)
            }, null, 2);
        }

        case 'update_plan': {
            const raw = Array.isArray(args.steps) ? args.steps : [];
            const steps: PlanStep[] = raw.map((s: any) => ({
                title: String(s?.title ?? 'Step'),
                status: (['pending', 'in_progress', 'completed', 'failed'].includes(s?.status) ? s.status : 'pending') as PlanStep['status']
            }));
            ctx.onPlan(steps);
            return `Plan updated (${steps.length} steps).`;
        }

        case 'ask_user': {
            const q = str(args.question);
            const answer = await ctx.confirmQuestion(q);
            return answer === undefined ? 'User dismissed the question.' : `User answered: ${answer}`;
        }

        case 'remember': {
            const text = str(args.text);
            const tags = Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : [];
            const entry = ctx.memory.add(text, tags);
            return `Remembered (id=${entry.id}): ${entry.text}`;
        }

        case 'recall': {
            const q = str(args.query);
            const hits = ctx.memory.search(q, 10);
            if (!hits.length) { return 'No matching memories.'; }
            return hits
                .map((m) => `${m.id} | ${new Date(m.createdAt).toISOString().slice(0, 10)} | ${m.text}${m.tags.length ? ' [tags: ' + m.tags.join(', ') + ']' : ''}`)
                .join('\n');
        }

        case 'forget': {
            const id = str(args.id);
            return ctx.memory.remove(id) ? `Forgot ${id}.` : `No memory with id ${id}.`;
        }

        default:
            return `ERROR: unknown tool "${name}".`;
    }
}

function countOccurrences(haystack: string, needle: string): number {
    if (!needle) { return 0; }
    let c = 0;
    let i = 0;
    while ((i = haystack.indexOf(needle, i)) !== -1) { c++; i += needle.length; }
    return c;
}

function detectFramework(pkg: any): string {
    if (!pkg) { return 'unknown'; }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next) { return 'Next.js'; }
    if (deps.nuxt) { return 'Nuxt'; }
    if (deps['@angular/core']) { return 'Angular'; }
    if (deps.svelte) { return 'Svelte'; }
    if (deps.vue) { return 'Vue'; }
    if (deps.react) { return 'React'; }
    if (deps.vite) { return 'Vite'; }
    if (deps.express) { return 'Express'; }
    if (deps.fastify) { return 'Fastify'; }
    if (deps.electron) { return 'Electron'; }
    return 'Node.js';
}

export function describeTool(name: string, args: Record<string, unknown>): string {
    switch (name) {
        case 'read_file': return `Read ${args.path}`;
        case 'list_files': return `List files${args.glob ? ' (' + args.glob + ')' : ''}`;
        case 'search_files': return `Search "${args.query}"`;
        case 'write_file': return `Write ${args.path}`;
        case 'apply_edit': return `Edit ${args.path}`;
        case 'delete_file': return `Delete ${args.path}`;
        case 'run_command': return `Run: ${args.command}`;
        case 'start_server': return `Start: ${args.command}`;
        case 'stop_server': return `Stop ${args.id}`;
        case 'get_diagnostics': return 'Check problems';
        case 'get_project_info': return 'Analyse project';
        case 'update_plan': return 'Update plan';
        case 'ask_user': return 'Ask user';
        case 'remember': return 'Save to memory';
        case 'recall': return 'Recall memory';
        case 'forget': return 'Forget memory';
        default: return name;
    }
}

export const vscodeApi = vscode;

