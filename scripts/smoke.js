/**
 * Smoke test: loads the compiled extension with a stubbed `vscode` module.
 * Catches import-time crashes and broken command registration without a real editor.
 *
 * Usage: node scripts/smoke.js
 */
const Module = require('module');
const path = require('path');

const commands = new Map();
const disposables = [];
const posted = [];

const uri = (p) => ({
    fsPath: p,
    path: p.replace(/\\/g, '/'),
    scheme: 'file',
    toString: () => 'file://' + encodeURI(p.replace(/\\/g, '/')),
    with: (o) => uri(o.path || p),
    query: ''
});

const vscodeStub = {
    Uri: {
        file: (p) => uri(p),
        parse: (p) => uri(p),
        joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts))
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    ViewColumn: { One: 1, Two: 2 },
    workspace: {
        workspaceFolders: [{ uri: uri(path.join(__dirname, '..')), name: 'ai-coding-agent', index: 0 }],
        getConfiguration: () => ({
            get: (key, def) => def
        }),
        fs: {
            stat: async () => ({ size: 10, type: 1 }),
            readFile: async () => Buffer.from('{}'),
            writeFile: async () => undefined,
            createDirectory: async () => undefined,
            delete: async () => undefined
        },
        findFiles: async () => [],
        asRelativePath: (u) => (typeof u === 'string' ? u : u.fsPath),
        registerTextDocumentContentProvider: () => ({ dispose() {} }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
        onDidSaveTextDocument: () => ({ dispose() {} })
    },
    window: {
        activeTextEditor: undefined,
        createOutputChannel: () => ({
            append() {}, appendLine() {}, show() {}, dispose() {}, clear() {}
        }),
        createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show() {}, hide() {}, dispose() {} }),
        registerWebviewViewProvider: () => ({ dispose() {} }),
        registerUriHandler: () => ({ dispose() {} }),
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showInputBox: async () => undefined,
        showQuickPick: async () => undefined,
        onDidChangeActiveTextEditor: () => ({ dispose() {} })
    },
    commands: {
        registerCommand: (id, fn) => {
            commands.set(id, fn);
            return { dispose() {} };
        },
        executeCommand: async () => undefined
    },
    languages: {
        getDiagnostics: () => []
    },
    env: { openExternal: async () => true },
    ThemeColor: class { constructor(v) { this.value = v; } },
    WebviewViewProvider: class {},
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
    CancellationTokenSource: class { constructor() { this.token = { isCancellationRequested: false }; } cancel() {} },
    Disposable: class { constructor(fn) { this.dispose = fn || (() => {}); } }
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') { return vscodeStub; }
    return origLoad.apply(this, arguments);
};

async function main() {
    const ext = require(path.join(__dirname, '..', 'out', 'extension.js'));
    if (typeof ext.activate !== 'function') {
        throw new Error('activate() not exported');
    }

    const secrets = new Map();
    const state = new Map();
    const context = {
        subscriptions: [],
        secrets: {
            get: async (k) => secrets.get(k),
            store: async (k, v) => { secrets.set(k, v); },
            delete: async (k) => { secrets.delete(k); }
        },
        globalState: {
            get: (k, d) => (state.has(k) ? state.get(k) : d),
            update: async (k, v) => { state.set(k, v); },
            keys: () => [...state.keys()],
            setKeysForSync: () => undefined
        },
        workspaceState: {
            get: (k, d) => d,
            update: async () => undefined,
            keys: () => []
        }
    };

    await ext.activate(context);
    console.log('activate() OK');

    const expected = [
        'aiCodingAgent.openChat',
        'aiCodingAgent.askCurrentFile',
        'aiCodingAgent.editSelection',
        'aiCodingAgent.explainError',
        'aiCodingAgent.fixCurrentFile',
        'aiCodingAgent.runProject',
        'aiCodingAgent.runTests',
        'aiCodingAgent.reviewChanges',
        'aiCodingAgent.stopAgent',
        'aiCodingAgent.newChat',
        'aiCodingAgent.clearChat',
        'aiCodingAgent.setApiKey',
        'aiCodingAgent.clearApiKey',
        'aiCodingAgent.openSettings',
        'aiCodingAgent.undoLastChange',
        'aiCodingAgent.undoAllChanges',
        'aiCodingAgent.showMemory',
        'aiCodingAgent.clearMemory',
        'aiCodingAgent.chatHistory',
        'aiCodingAgent.clearSession'
    ];

    let missing = 0;
    for (const id of expected) {
        if (!commands.has(id)) { console.log('MISSING command: ' + id); missing++; }
    }
    if (missing) { throw new Error(missing + ' commands missing'); }
    console.log('commands registered: ' + commands.size);

    // invoke the harmless ones
    await commands.get('aiCodingAgent.openChat')();
    await commands.get('aiCodingAgent.newChat')();
    console.log('command invocation OK');

    ext.deactivate();
    console.log('deactivate() OK');
    console.log('\nSMOKE TEST PASSED');
}

main().catch((e) => {
    console.error('SMOKE TEST FAILED:', e);
    process.exit(1);
});
