/**
 * Minimal line diff (LCS) used for the approval previews. Pure, no deps.
 */
export interface DiffLine {
    type: ' ' | '-' | '+';
    text: string;
}

export function diffLines(before: string, after: string): DiffLine[] {
    const a = (before ?? '').split(/\r?\n/);
    const b = (after ?? '').split(/\r?\n/);
    const n = a.length;
    const m = b.length;

    // Guard against pathological sizes
    if (n * m > 4_000_000) {
        return [
            ...a.map<DiffLine>((t) => ({ type: '-', text: t })),
            ...b.map<DiffLine>((t) => ({ type: '+', text: t }))
        ];
    }

    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ type: ' ', text: a[i] });
            i++; j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            out.push({ type: '-', text: a[i] });
            i++;
        } else {
            out.push({ type: '+', text: b[j] });
            j++;
        }
    }
    while (i < n) { out.push({ type: '-', text: a[i++] }); }
    while (j < m) { out.push({ type: '+', text: b[j++] }); }
    return out;
}

/** Compact ```diff block for chat display. */
export function diffToMarkdown(before: string, after: string, maxLines = 120): string {
    const lines = diffLines(before, after);
    const changes = lines.filter((l) => l.type !== ' ');
    const shown = changes.length > maxLines ? changes.slice(0, maxLines) : changes;
    const body = shown.map((l) => `${l.type}${l.text}`).join('\n');
    return '```diff\n' + body + (changes.length > maxLines ? `\n… (${changes.length - maxLines} more changed lines)` : '') + '\n```';
}

export function describeChange(before: string | null, after: string): string {
    if (before === null) { return `New file (${after.split(/\r?\n/).length} lines)`; }
    const d = diffLines(before, after);
    const added = d.filter((l) => l.type === '+').length;
    const removed = d.filter((l) => l.type === '-').length;
    return `${added} added, ${removed} removed`;
}
