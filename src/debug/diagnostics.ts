import * as vscode from 'vscode';

export interface DiagSummary {
    total: number;
    errors: number;
    warnings: number;
    items: Array<{ file: string; line: number; severity: string; message: string; source?: string }>;
}

const SEVERITY = ['Error', 'Warning', 'Information', 'Hint'];

export function collectDiagnostics(root: string, onlyFile?: string): DiagSummary {
    const all = vscode.languages.getDiagnostics();
    const items: DiagSummary['items'] = [];
    let errors = 0;
    let warnings = 0;

    for (const [uri, diags] of all) {
        if (!uri.fsPath.startsWith(root)) { continue; }
        if (onlyFile && !uri.fsPath.endsWith(onlyFile.replace(/\\/g, '/'))) { continue; }
        for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) { errors++; }
            if (d.severity === vscode.DiagnosticSeverity.Warning) { warnings++; }
            items.push({
                file: vscode.workspace.asRelativePath(uri),
                line: d.range.start.line + 1,
                severity: SEVERITY[d.severity] ?? 'Info',
                message: d.message,
                source: d.source
            });
        }
    }

    items.sort((a, b) => (a.severity === 'Error' ? -1 : 1) - (b.severity === 'Error' ? -1 : 1));
    return { total: items.length, errors, warnings, items: items.slice(0, 80) };
}

/** Ask the user to pick a failing diagnostic and return a prompt describing it. */
export async function pickProblemForPrompt(): Promise<string | undefined> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const summary = collectDiagnostics(root);
    if (!summary.items.length) { return undefined; }

    const pick = await vscode.window.showQuickPick(
        summary.items.map((i) => ({
            label: `${i.severity === 'Error' ? '$(error)' : '$(warning)'} ${i.message}`,
            description: `${i.file}:${i.line}`,
            detail: i.source,
            item: i
        })),
        { placeHolder: 'Select a problem for the AI to fix' }
    );
    if (!pick) { return undefined; }
    const i = (pick as any).item as DiagSummary['items'][number];
    return `Explain and fix this ${i.severity.toLowerCase()} in ${i.file} at line ${i.line}:\n\n${i.message}\n\n` +
        `Read the file, find the root cause and propose a minimal fix.`;
}
