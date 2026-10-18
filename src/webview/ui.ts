export interface UiState {
    provider: string;
    model: string;
    mode: 'ask' | 'agent';
    hasKey: boolean;
}

export function getHtml(nonce: string, state: UiState): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data: https:;" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AI Coding Agent</title>
<style nonce="${nonce}">
  :root {
    --gap: 10px;
    --radius: 10px;
    --border: var(--vscode-panel-border, rgba(128,128,128,.35));
    --bg: var(--vscode-sideBar-background, #1e1e1e);
    --fg: var(--vscode-foreground, #ddd);
    --muted: var(--vscode-descriptionForeground, #999);
    --accent: var(--vscode-button-background, #0e639c);
    --accent-fg: var(--vscode-button-foreground, #fff);
    --code-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15));
    --input-bg: var(--vscode-input-background, #2b2b2b);
    --input-fg: var(--vscode-input-foreground, #eee);
    --input-border: var(--vscode-input-border, rgba(128,128,128,.45));
    --card: var(--vscode-editorWidget-background, rgba(128,128,128,.08));
    --border-color: var(--vscode-input-border, rgba(128,128,128,.4));
    --ok: var(--vscode-testing-iconPassed, #4caf50);
    --bad: var(--vscode-testing-iconFailed, #f14c4c);
    --warn: var(--vscode-editorWarning-foreground, #d7a03a);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg);
    font-family: var(--vscode-font-family, -apple-system, "Segoe UI", sans-serif);
    font-size: var(--vscode-font-size, 13px);
    overflow: hidden;
  }

  header {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap;
  }
  .brand { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; letter-spacing: .02em; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .dot.busy { background: var(--warn); box-shadow: 0 0 6px var(--warn); animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  .spacer { flex: 1; }

  .chip {
    border: 1px solid var(--border); border-radius: 999px;
    padding: 2px 8px; font-size: 11px; color: var(--muted);
    white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
  }
  .chip-btn {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--border); border-radius: 999px;
    padding: 3px 10px; font-size: 11px; color: var(--fg);
    background: linear-gradient(180deg, rgba(124,92,255,.18), rgba(56,132,255,.10));
    max-width: 210px; cursor: pointer;
  }
  .chip-btn:hover { border-color: var(--accent); }
  .chip-btn .caret { color: var(--muted); font-size: 9px; }
  .menu-title {
    padding: 4px 8px 2px; font-size: 9.5px; letter-spacing: .08em;
    text-transform: uppercase; color: var(--muted);
  }
  .model-menu { min-width: 220px; max-height: 380px; overflow: auto; }
  .model-menu button { display: flex; justify-content: space-between; gap: 8px; }
  .model-menu .tag {
    font-size: 9px; padding: 1px 5px; border-radius: 999px;
    background: rgba(124,92,255,.25); color: #cfc6ff;
  }
  .quick { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 12px; }
  .quick button { font-size: 11px; padding: 4px 9px; border-radius: 999px; }
  button {
    background: transparent; color: var(--fg); border: 1px solid var(--border);
    border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer;
    font-family: inherit;
  }
  button:hover:not(:disabled) { background: var(--card); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
  button.primary:hover:not(:disabled) { filter: brightness(1.1); }
  button.danger { color: var(--bad); border-color: var(--bad); }

  .modes { display: flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
  .modes button { border: 0; border-radius: 0; padding: 3px 10px; font-size: 11px; }
  .modes button.active { background: var(--accent); color: var(--accent-fg); }

  #plan {
    padding: 6px 10px; border-bottom: 1px solid var(--border);
    display: none; max-height: 200px; overflow: auto; font-size: 11.5px;
  }
  #plan .plan-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em;
  }
  #plan .plan-bar { flex: 1; height: 4px; border-radius: 4px; background: rgba(128,128,128,.25); overflow: hidden; }
  #plan .plan-fill { height: 100%; background: var(--ok); width: 0%; transition: width .25s ease; }
  #plan .step { display: flex; gap: 6px; padding: 2px 0; align-items: flex-start; }
  #plan .step.active { font-weight: 600; }
  #plan .bullet { width: 14px; flex: 0 0 14px; text-align: center; }
  .s-pending { color: var(--muted); }
  .s-in_progress { color: var(--warn); }
  .s-completed { color: var(--ok); }
  .s-failed { color: var(--bad); }

  #messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }

  .msg { display: flex; flex-direction: column; gap: 4px; }
  .msg .role { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .msg.user .bubble {
    background: var(--vscode-input-background, rgba(128,128,128,.12));
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 8px 10px; white-space: pre-wrap; word-break: break-word;
  }
  .msg.assistant .bubble {
    border-left: 2px solid var(--accent); padding: 2px 0 2px 10px;
    word-break: break-word; line-height: 1.55;
  }
  .bubble p { margin: 0 0 8px; }
  .bubble p:last-child { margin-bottom: 0; }
  .bubble ul, .bubble ol { margin: 6px 0 8px 18px; padding: 0; }
  .bubble li { margin: 2px 0; }
  .bubble h1, .bubble h2, .bubble h3 { font-size: 13.5px; margin: 10px 0 6px; }
  .bubble a { color: var(--vscode-textLink-foreground, #4daafc); }
  code.inline { background: var(--code-bg); border-radius: 4px; padding: 1px 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .codeblock { position: relative; margin: 8px 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .codeblock .cb-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 8px; background: var(--card); border-bottom: 1px solid var(--border);
    font-size: 10.5px; color: var(--muted);
  }
  .codeblock pre {
    margin: 0; padding: 8px 10px; overflow-x: auto;
    background: var(--code-bg);
    font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.45;
  }
  .codeblock.diff pre .add { color: var(--ok); }
  .codeblock.diff pre .del { color: var(--bad); }

  .tool {
    display: flex; gap: 8px; align-items: flex-start;
    font-size: 11.5px; color: var(--muted);
    border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px;
    background: var(--card);
  }
  .tool .t-icon { flex: 0 0 14px; }
  .tool .t-body { flex: 1; min-width: 0; }
  .tool .t-name { color: var(--fg); font-weight: 600; }
  .tool .t-summary { white-space: pre-wrap; word-break: break-word; opacity: .85; }

  .card {
    border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
    background: var(--card);
  }
  .card .c-head { padding: 8px 10px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 12px; display: flex; gap: 8px; align-items: center; }
  .card .c-body { padding: 8px 10px; font-size: 11.5px; color: var(--muted); }
  .card .c-actions { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--border); }
  .risk-low { color: var(--ok); }
  .risk-medium { color: var(--warn); }
  .risk-high { color: var(--bad); }

  .err { border-left: 2px solid var(--bad); padding-left: 8px; color: var(--bad); font-size: 12px; }
  .info { border-left: 2px solid var(--accent); padding-left: 8px; color: var(--muted); font-size: 12px; }

  .menu-wrap { position: relative; }
  .menu {
    display: none; position: absolute; right: 0; top: calc(100% + 4px); z-index: 50;
    min-width: 170px; padding: 4px; border-radius: 8px;
    background: var(--vscode-menu-background, #14141c);
    border: 1px solid var(--vscode-menu-border, var(--border));
    box-shadow: 0 6px 20px rgba(0,0,0,.45);
  }
  .menu.open { display: block; }
  .menu button {
    display: block; width: 100%; text-align: left; border: 0; border-radius: 5px;
    padding: 5px 8px; font-size: 11.5px;
  }
  .menu button:hover { background: var(--vscode-menu-selectionBackground, var(--accent)); color: var(--vscode-menu-selectionForeground, #fff); }

  footer { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  #activity { font-size: 11px; color: var(--muted); min-height: 14px; display: flex; gap: 8px; align-items: center; }
  .composer { display: flex; gap: 6px; align-items: flex-end; }
  textarea {
    flex: 1; resize: none; min-height: 38px; max-height: 180px;
    background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border);
    border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 12.5px; line-height: 1.4;
    outline: none;
  }
  textarea:focus { border-color: var(--vscode-focusBorder, var(--accent)); }
  .hint { font-size: 10.5px; color: var(--muted); }
  .empty { color: var(--muted); font-size: 12px; text-align: center; margin: auto 0; padding: 20px; line-height: 1.6; }
  .empty b { color: var(--fg); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(128,128,128,.4)); border-radius: 6px; }
</style>
</head>
<body>
<header>
  <span class="brand"><span class="dot" id="dot"></span>AI Coding Agent</span>
  <div class="menu-wrap">
    <button id="modelBtn" class="chip-btn" title="Switch model">
      <span id="modelChip">…</span><span class="caret">▾</span>
    </button>
    <div id="modelMenu" class="menu model-menu">
      <div class="menu-title">DeepSeek</div>
      <button data-provider="custom" data-model="deepseek-v4-pro">deepseek-v4-pro <span class="tag">agent</span></button>
      <button data-provider="custom" data-model="deepseek-flash">deepseek-flash <span class="tag">fast</span></button>
      <div class="menu-title">OpenAI</div>
      <button data-provider="openai" data-model="gpt-4o-mini">gpt-4o-mini</button>
      <button data-provider="openai" data-model="gpt-4o">gpt-4o</button>
      <div class="menu-title">Anthropic</div>
      <button data-provider="anthropic" data-model="claude-sonnet-4-5">claude-sonnet-4-5</button>
      <button data-provider="anthropic" data-model="claude-opus-4-1">claude-opus-4-1</button>
      <div class="menu-title">Google</div>
      <button data-provider="gemini" data-model="gemini-2.5-flash">gemini-2.5-flash</button>
      <button data-provider="gemini" data-model="gemini-2.5-pro">gemini-2.5-pro</button>
      <div class="menu-title">Local (Ollama)</div>
      <button data-provider="ollama" data-model="qwen2.5-coder:7b">qwen2.5-coder:7b</button>
      <button data-provider="ollama" data-model="llama3.2:3b">llama3.2:3b</button>
    </div>
  </div>
  <div class="spacer"></div>
  <div class="modes">
    <button id="modeAsk" title="Read-only answers">Ask</button>
    <button id="modeAgent" class="active" title="Can edit files and run commands">Agent</button>
  </div>
  <button id="btnNew" title="New chat">New</button>
  <button id="btnStop" class="danger" disabled title="Stop the agent">Stop</button>
  <div class="menu-wrap">
    <button id="btnMenu" title="More actions">⋯</button>
    <div id="menu" class="menu">
      <button data-act="new">New chat</button>
      <button data-act="history">Chat history…</button>
      <button data-act="clear">Clear chat</button>
      <button data-act="clearSession">Clear session</button>
      <button data-act="memory">Memory…</button>
      <button data-act="settings">Settings</button>
    </div>
  </div>
</header>

<div id="plan"></div>
<div id="messages">
  <div class="empty" id="empty">
    <b>Ask anything about this project.</b><br/>
    Try: <i>"Mere project mein login page banao"</i><br/>
    or <i>"@src/app.ts explain this file"</i>
    <div class="quick">
      <button data-q="Explain the current file: what it does, its key parts and any risks.">Explain file</button>
      <button data-q="/fix">Fix errors</button>
      <button data-q="/test">Run tests</button>
      <button data-q="/plan Add a dark mode toggle">Plan a feature</button>
    </div>
  </div>
</div>

<footer>
  <div id="activity"></div>
  <div class="composer">
    <textarea id="input" rows="1" placeholder="Task likho…  /help se commands, @file se context attach"></textarea>
    <button id="btnSend" class="primary">Send</button>
  </div>
  <div class="hint"><span id="usage">tokens: —</span> · Agent mode edits real files — you approve each step.</div>
</footer>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const messagesEl = $('messages');
  const inputEl = $('input');
  const sendBtn = $('btnSend');
  const stopBtn = $('btnStop');
  const planEl = $('plan');
  const activityEl = $('activity');
  const dotEl = $('dot');
  const emptyEl = $('empty');

  let mode = ${JSON.stringify(state.mode)};
  let busy = false;
  let current = null;       // current assistant element
  let pending = new Map();  // approval/question id -> card element

  // model picker
  const modelMenu = $('modelMenu');
  $('modelBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    modelMenu.classList.toggle('open');
  });
  modelMenu.addEventListener('click', function (e) {
    const btn = e.target.closest ? e.target.closest('button[data-model]') : null;
    if (!btn) { return; }
    modelMenu.classList.remove('open');
    vscode.postMessage({ type: 'selectModel', provider: btn.dataset.provider, model: btn.dataset.model });
  });

  // quick actions in the empty state
  messagesEl.addEventListener('click', function (e) {
    const btn = e.target.closest ? e.target.closest('button[data-q]') : null;
    if (!btn) { return; }
    inputEl.value = btn.dataset.q || '';
    send();
  });

  document.addEventListener('click', function () { modelMenu.classList.remove('open'); });

  function setBusy(v) {
    busy = v;
    // keep Send enabled so messages can be queued while the agent is working
    sendBtn.disabled = false;
    sendBtn.textContent = v ? 'Queue' : 'Send';
    stopBtn.disabled = !v;
    dotEl.className = 'dot' + (v ? ' busy' : '');
  }

  function scroll() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>');
    s = s.replace(/\`([^\`]+)\`/g, '<code class="inline">$1</code>');
    s = s.replace(/\\[([^\\]]+)\\]\\((https?:[^)]+)\\)/g, '<a href="$2">$1</a>');
    return s;
  }

  function renderMarkdown(text) {
    const parts = String(text).split(/\`\`\`/);
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const raw = parts[i];
        const nl = raw.indexOf('\\n');
        const lang = nl > -1 ? raw.slice(0, nl).trim() : '';
        const code = nl > -1 ? raw.slice(nl + 1) : raw;
        const isDiff = lang === 'diff';
        const body = isDiff
          ? code.split('\\n').map(function (l) {
              const c = l.charAt(0);
              const cls = c === '+' ? 'add' : c === '-' ? 'del' : '';
              return cls ? '<span class="' + cls + '">' + esc(l) + '</span>' : esc(l);
            }).join('\\n')
          : esc(code);
        html += '<div class="codeblock' + (isDiff ? ' diff' : '') + '">' +
          '<div class="cb-head"><span>' + esc(lang || 'text') + '</span>' +
          '<button class="copy" data-code="' + encodeURIComponent(code) + '">Copy</button></div>' +
          '<pre>' + body + '</pre></div>';
      } else {
        const lines = parts[i].split('\\n');
        let out = '';
        let inList = false;
        for (const line of lines) {
          const t = line.trimEnd();
          if (/^\\s*[-*]\\s+/.test(t)) {
            if (!inList) { out += '<ul>'; inList = true; }
            out += '<li>' + inline(t.replace(/^\\s*[-*]\\s+/, '')) + '</li>';
            continue;
          }
          if (inList) { out += '</ul>'; inList = false; }
          if (!t.trim()) { continue; }
          const h = t.match(/^(#{1,3})\\s+(.*)$/);
          if (h) { out += '<h' + (h[1].length + 2) + '>' + inline(h[2]) + '</h' + (h[1].length + 2) + '>'; continue; }
          out += '<p>' + inline(t) + '</p>';
        }
        if (inList) { out += '</ul>'; }
        html += out;
      }
    }
    return html;
  }

  function addMessage(role, text) {
    if (emptyEl && emptyEl.parentNode) { emptyEl.remove(); }
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const label = document.createElement('div');
    label.className = 'role';
    label.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'Agent' : role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = role === 'user' ? esc(text) : renderMarkdown(text || '');
    wrap.appendChild(label);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scroll();
    return { wrap: wrap, bubble: bubble };
  }

  function addTool(name, args, id) {
    const el = document.createElement('div');
    el.className = 'tool';
    el.id = 'tool-' + id;
    el.innerHTML = '<span class="t-icon">⚙</span><div class="t-body">' +
      '<span class="t-name">' + esc(name) + '</span> ' +
      '<span class="t-summary">' + esc(summarise(name, args)) + '</span></div>';
    messagesEl.appendChild(el);
    scroll();
    return el;
  }

  function summarise(name, args) {
    if (!args) { return ''; }
    if (args.path) { return String(args.path); }
    if (args.command) { return String(args.command); }
    if (args.query) { return '"' + String(args.query) + '"'; }
    if (args.glob) { return String(args.glob); }
    return '';
  }

  function addCard(kind, id, title, detail, preview, risk, command) {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'card-' + id;
    let html = '<div class="c-head">' + esc(title) +
      (risk ? ' <span class="risk-' + risk + '">• ' + esc(risk) + ' risk</span>' : '') + '</div>';
    if (detail) { html += '<div class="c-body">' + esc(detail) + '</div>'; }
    if (preview) { html += '<div class="c-body">' + renderMarkdown(preview) + '</div>'; }
    html += '<div class="c-actions">' +
      (kind === 'question'
        ? '<button class="primary" data-answer="1">Answer</button>'
        : '<button class="primary" data-accept="1">Accept</button><button data-reject="1">Reject</button>' +
          (command ? '<button data-always="1" title="Auto-approve this exact command for this session">Always allow</button>' : '')) +
      '</div>';
    card.innerHTML = html;

    card.addEventListener('click', function (ev) {
      const t = ev.target;
      if (t.dataset.accept) {
        vscode.postMessage({ type: 'approval', id: id, accepted: true });
        lockCard(card, 'Accepted');
      } else if (t.dataset.always) {
        vscode.postMessage({ type: 'approval', id: id, accepted: true, always: true, command: command });
        lockCard(card, 'Always allowed');
      } else if (t.dataset.reject) {
        vscode.postMessage({ type: 'approval', id: id, accepted: false });
        lockCard(card, 'Rejected');
      } else if (t.dataset.answer) {
        const v = window.prompt('Your answer:');
        if (v !== null) {
          vscode.postMessage({ type: 'answer', id: id, value: v });
          lockCard(card, 'Answered: ' + v);
        }
      }
    });

    messagesEl.appendChild(card);
    pending.set(id, card);
    scroll();
  }

  function lockCard(card, label) {
    const actions = card.querySelector('.c-actions');
    if (actions) { actions.innerHTML = '<span class="hint">' + esc(label) + '</span>'; }
  }

  function renderPlan(steps) {
    if (!steps || !steps.length) { planEl.style.display = 'none'; return; }

    // merge duplicate titles (the agent often re-publishes the same plan)
    const merged = [];
    const index = new Map();
    for (const s of steps) {
      const title = String(s.title || 'Step');
      if (index.has(title)) {
        merged[index.get(title)].status = s.status;
      } else {
        index.set(title, merged.length);
        merged.push({ title: title, status: s.status });
      }
    }

    const total = merged.length;
    const done = merged.filter(function (s) { return s.status === 'completed'; }).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const icon = { pending: '○', in_progress: '◐', completed: '●', failed: '✕' };

    planEl.style.display = 'block';
    planEl.innerHTML =
      '<div class="plan-head"><span>' + done + '/' + total + ' steps</span>' +
      '<span class="plan-bar"><span class="plan-fill" style="width:' + pct + '%"></span></span></div>' +
      merged.map(function (s) {
        return '<div class="step' + (s.status === 'in_progress' ? ' active' : '') + '">' +
          '<span class="bullet s-' + s.status + '">' + (icon[s.status] || '○') + '</span>' +
          '<span class="s-' + s.status + '">' + esc(s.title) + '</span></div>';
      }).join('');

    const active = planEl.querySelector('.step.active');
    if (active && active.scrollIntoView) { active.scrollIntoView({ block: 'nearest' }); }
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text) { return; }
    inputEl.value = '';
    inputEl.style.height = 'auto';
    current = null;
    if (!busy) { planEl.style.display = 'none'; }
    vscode.postMessage({ type: 'send', text: text, mode: mode });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(180, inputEl.scrollHeight) + 'px';
  });
  stopBtn.addEventListener('click', function () { vscode.postMessage({ type: 'stop' }); });
  $('btnNew').addEventListener('click', function () {
    messagesEl.innerHTML = '';
    planEl.style.display = 'none';
    vscode.postMessage({ type: 'newChat' });
  });

  // ⋯ menu
  const menuEl = $('menu');
  $('btnMenu').addEventListener('click', function (e) {
    e.stopPropagation();
    menuEl.classList.toggle('open');
  });
  menuEl.addEventListener('click', function (e) {
    const act = e.target && e.target.dataset ? e.target.dataset.act : '';
    if (!act) { return; }
    menuEl.classList.remove('open');
    vscode.postMessage({ type: 'action', action: act });
  });
  document.addEventListener('click', function () { menuEl.classList.remove('open'); });

  document.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('copy')) {
      const code = decodeURIComponent(e.target.dataset.code || '');
      navigator.clipboard.writeText(code).then(function () {
        e.target.textContent = 'Copied';
        setTimeout(function () { e.target.textContent = 'Copy'; }, 1200);
      });
    }
  });

  function setMode(m) {
    mode = m;
    $('modeAsk').classList.toggle('active', m === 'ask');
    $('modeAgent').classList.toggle('active', m === 'agent');
    vscode.postMessage({ type: 'mode', mode: m });
  }
  $('modeAsk').addEventListener('click', function () { setMode('ask'); });
  $('modeAgent').addEventListener('click', function () { setMode('agent'); });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    switch (msg.type) {
      case 'userEcho':
        addMessage('user', msg.text || '');
        setBusy(true);
        break;

      case 'queued': {
        const w = addMessage('user', msg.text || '');
        const tag = document.createElement('div');
        tag.className = 'hint';
        tag.textContent = '⏳ queued' + (msg.position ? ' #' + msg.position : '');
        w.wrap.appendChild(tag);
        break;
      }

      case 'dequeued':
        activityEl.textContent = '▶ sending queued message…';
        break;

      case 'state':
        $('modelChip').textContent = msg.state.provider + ' · ' + msg.state.model;
        if (msg.state.mode) { setMode(msg.state.mode); }
        if (!msg.state.hasKey) {
          addMessage('assistant', '**:warning: No API key configured.**\\n\\nRun **AI Coding Agent: Set API Key** from the command palette, then reopen this panel.');
        }
        break;

      case 'status':
        dotEl.className = 'dot' + (msg.text && msg.text !== 'Ready' ? ' busy' : '');
        activityEl.textContent = msg.text || '';
        if (msg.text === 'Ready' || msg.text === 'Stopped' || msg.text === 'Error') { setBusy(false); }
        break;

      case 'activity':
        activityEl.textContent = msg.text || '';
        break;

      case 'delta':
        if (!current) { current = addMessage('assistant', ''); }
        current.raw = (current.raw || '') + msg.text;
        current.bubble.innerHTML = renderMarkdown(current.raw);
        scroll();
        break;

      case 'assistant':
        if (!current) { current = addMessage('assistant', msg.text || ''); }
        else if (msg.text) {
          current.raw = msg.text;
          current.bubble.innerHTML = renderMarkdown(msg.text);
        }
        current = null;
        scroll();
        break;

      case 'toolStart':
        addTool(msg.name, msg.args, msg.id);
        break;

      case 'toolEnd': {
        const el = document.getElementById('tool-' + msg.id);
        if (el) {
          el.querySelector('.t-icon').textContent = msg.ok ? '✓' : '✕';
          if (msg.summary) {
            const s = document.createElement('div');
            s.className = 't-summary';
            s.textContent = msg.summary;
            el.querySelector('.t-body').appendChild(s);
          }
        }
        break;
      }

      case 'plan':
        renderPlan(msg.steps);
        break;

      case 'approval':
        addCard('approval', msg.id, msg.req.title, msg.req.detail, msg.req.preview, msg.req.risk, msg.req.command);
        break;

      case 'usage':
        $('usage').textContent = 'tokens: ' +
          (msg.estimated ? '~' : '') + Math.round(msg.input) + ' in / ' +
          (msg.estimated ? '~' : '') + Math.round(msg.output) + ' out';
        break;

      case 'history':
        if (Array.isArray(msg.messages)) {
          for (const m of msg.messages) {
            if (m && m.text) { addMessage(m.role === 'user' ? 'user' : 'assistant', m.text); }
          }
        }
        break;

      case 'cleared':
        messagesEl.innerHTML = '<div class="empty" id="empty"><b>New chat.</b><br/>Type a task or <i>/help</i> for commands.</div>';
        planEl.style.display = 'none';
        $('usage').textContent = 'tokens: —';
        break;

      case 'fileChanged':
        activityEl.textContent = '✓ updated ' + msg.rel;
        break;

      case 'question':
        addCard('question', msg.id, 'Agent asks', msg.question, '', '');
        break;

      case 'error':
        addMessage('assistant', '**Error:** ' + msg.text);
        break;

      case 'info':
        addMessage('assistant', msg.text);
        break;

      case 'done':
        setBusy(false);
        current = null;
        break;
    }
  });

  setBusy(false);
  vscode.postMessage({ type: 'ready' });

  // Auto-focus the composer so the panel is ready for typing/paste.
  function focusInput() {
    try { inputEl.focus(); } catch (e) { /* noop */ }
  }
  setTimeout(focusInput, 150);
  setTimeout(focusInput, 700);
  window.addEventListener('focus', focusInput);
  messagesEl.addEventListener('click', focusInput);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { focusInput(); }
  });
})();
</script>
</body>
</html>`;
}
