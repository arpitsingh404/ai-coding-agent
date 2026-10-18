export type CommandPolicy = 'strict' | 'warn' | 'off';

/**
 * Pure command-safety analyser (no vscode import - unit tested).
 *
 * policy:
 *   strict (default) - catastrophic commands are hard-blocked
 *   warn             - nothing is blocked, everything risky needs approval
 *   off              - no analysis at all (100% free execution)
 */

export type Risk = 'low' | 'medium' | 'high';

export interface CommandVerdict {
    blocked: boolean;
    reason?: string;
    risk: Risk;
}

const HARD_BLOCK: Array<{ re: RegExp; why: string }> = [
    { re: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+(\/|\/\*|~|\$HOME)\s*$/i, why: 'Recursive delete of the filesystem or home directory.' },
    { re: /\brm\s+-rf\s+\/(?!\w)/i, why: 'Recursive delete of the filesystem root.' },
    { re: /\bmkfs(\.[a-z0-9]+)?\b/i, why: 'Formatting a filesystem.' },
    { re: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|vd)/i, why: 'Raw write to a block device.' },
    { re: />\s*\/dev\/(sd|nvme|hd|vd)[a-z0-9]/i, why: 'Raw write to a block device.' },
    { re: /\b(shutdown|reboot|poweroff|halt)\b/i, why: 'Shutting down or rebooting the machine.' },
    { re: /\binit\s+0\b|\bsystemctl\s+(poweroff|reboot|halt)\b/i, why: 'Shutting down or rebooting the machine.' },
    { re: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, why: 'Fork bomb.' },
    { re: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/i, why: 'Opening permissions on the filesystem root.' },
    { re: /\bchown\s+-R\s+[^\n]+\s+\/(\s|$)/i, why: 'Recursive ownership change on the filesystem root.' },
    { re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b/i, why: 'Piping a remote script straight into a shell.' },
    { re: /\bpasswd\s+root\b|\buseradd\s+-[^\n]*root\b/i, why: 'Modifying root credentials.' },
    { re: /\bhistory\s+-c\b|\bshred\b[^\n]*\.bash_history/i, why: 'Destroying audit trail.' },
    { re: /\bgit\s+push\s+[^\n]*--force\b/i, why: 'Force-pushing over remote history.' },
    { re: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i, why: 'Publishing a package to a public registry.' }
];

const HIGH_RISK: RegExp[] = [
    /\bsudo\b/i,
    /\brm\s+-[a-zA-Z]*r/i,
    /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s)/i,
    /\b(kill|pkill|killall)\b/i,
    /\bdocker\s+(rm|rmi|system\s+prune|volume\s+rm)/i,
    /\b(npm|yarn|pnpm)\s+(uninstall|remove)\b/i,
    /\b(apt|apt-get|dnf|yum)\s+(remove|purge|autoremove)\b/i,
    /\bchmod\s+-R\b|\bchown\s+-R\b/i,
    /\bmv\b[^\n]*\s\/(\s|$)/i
];

const MEDIUM_RISK: RegExp[] = [
    /\b(npm|yarn|pnpm)\s+(install|add|i)\b/i,
    /\bpip3?\s+install\b/i,
    /\bcargo\s+(add|install)\b/i,
    /\bgo\s+get\b/i,
    /\bgit\s+(commit|merge|rebase|push)\b/i,
    /\bmkdir\b|\btouch\b|\bcp\b|\bmv\b|\brm\b/i,
    /\bdocker\s+(run|build|compose)\b/i,
    /\b(curl|wget)\b/i
];

/** Commands that are fine to auto-run read-only. */
const LOW_RISK = /^(ls|dir|cat|head|tail|pwd|whoami|node\s+-v|npm\s+-v|git\s+(status|log|diff|branch)|type|echo|grep|find\s|[a-z]+\s+--version)\b/i;

export function analyseCommand(command: string, policy: CommandPolicy = 'strict'): CommandVerdict {
    const cmd = (command || '').trim();
    if (!cmd) {
        return { blocked: true, reason: 'Empty command.', risk: 'high' };
    }

    // 100% free mode: no rules at all
    if (policy === 'off') {
        return { blocked: false, risk: 'medium' };
    }

    for (const rule of HARD_BLOCK) {
        if (rule.re.test(cmd)) {
            if (policy === 'warn') {
                // no blocking, but force an approval prompt
                return { blocked: false, risk: 'high', reason: rule.why };
            }
            return { blocked: true, reason: rule.why, risk: 'high' };
        }
    }

    if (HIGH_RISK.some((re) => re.test(cmd))) {
        return { blocked: false, risk: 'high' };
    }
    if (MEDIUM_RISK.some((re) => re.test(cmd))) {
        return { blocked: false, risk: 'medium' };
    }
    if (LOW_RISK.test(cmd)) {
        return { blocked: false, risk: 'low' };
    }
    return { blocked: false, risk: 'medium' };
}

/**
 * Detect the project's package manager + scripts without executing anything.
 */
export interface ProjectCommands {
    packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'cargo' | 'go' | 'unknown';
    install?: string;
    dev?: string;
    build?: string;
    test?: string;
    start?: string;
}

export function detectCommands(files: string[], packageJson?: any): ProjectCommands {
    const has = (n: string) => files.some((f) => f.toLowerCase() === n.toLowerCase() || f.toLowerCase().endsWith('/' + n.toLowerCase()));

    if (packageJson && typeof packageJson === 'object') {
        const scripts = packageJson.scripts || {};
        const pm: ProjectCommands['packageManager'] =
            has('pnpm-lock.yaml') ? 'pnpm' :
            has('yarn.lock') ? 'yarn' :
            has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
        const run = (s: string) =>
            pm === 'npm' ? `npm run ${s}` : pm === 'yarn' ? `yarn ${s}` : pm === 'pnpm' ? `pnpm run ${s}` : `bun run ${s}`;
        const install = pm === 'npm' ? 'npm install' : pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm install' : 'bun install';
        return {
            packageManager: pm,
            install,
            dev: scripts.dev ? run('dev') : undefined,
            start: scripts.start ? run('start') : undefined,
            build: scripts.build ? run('build') : undefined,
            test: scripts.test ? (pm === 'npm' ? 'npm test' : run('test')) : undefined
        };
    }

    if (has('pyproject.toml')) {
        return { packageManager: 'poetry', install: 'poetry install', test: 'pytest -q', dev: undefined };
    }
    if (has('requirements.txt') || has('main.py')) {
        return { packageManager: 'pip', install: 'pip install -r requirements.txt', test: 'pytest -q' };
    }
    if (has('cargo.toml')) {
        return { packageManager: 'cargo', install: 'cargo build', test: 'cargo test', dev: 'cargo run' };
    }
    if (has('go.mod')) {
        return { packageManager: 'go', install: 'go mod download', test: 'go test ./...', dev: 'go run .' };
    }
    return { packageManager: 'unknown' };
}
