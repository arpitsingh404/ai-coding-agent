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
    display: none; max-height: 140px; overflow: auto; font-size: 11.5px;
  }
  #plan .step { display: flex; gap: 6px; padding: 2px 0; align-items: flex-start; }
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
  <span class="chip" id="modelChip">…</span>
  <div class="spacer"></div>
  <div class="modes">
    <button id="modeAsk" title="Read-only answers">Ask</button>
    <button id="modeAgent" class="active" title="Can edit files and run commands">Agent</button>
  </div>
  <button id="btnNew" title="New chat">New</button>
  <button id="btnStop" class="danger" disabled title="Stop the agent">Stop</button>
  <button id="btnSettings" title="Open settings">⚙</button>
</header>

<div id="plan"></div>
<div id="messages">
  <div class="empty" id="empty">
    <b>Ask anything about this project.</b><br/>
    Try: <i>"Mere project mein login page banao"</i><br/>
    or <i>"@src/app.ts explain this file"</i>
  </div>
</div>

<footer>
  <div id="activity"></div>
  <div class="composer">
    <textarea id="input" rows="1" placeholder="Describe a task…  (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="btnSend" class="primary">Send</button>
  </div>
  <div class="hint">Agent mode edits real files and runs commands — you approve each step.</div>
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

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
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

  function addCard(kind, id, title, detail, preview, risk) {
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
        : '<button class="primary" data-accept="1">Accept</button><button data-reject="1">Reject</button>') +
      '</div>';
    card.innerHTML = html;

    card.addEventListener('click', function (ev) {
      const t = ev.target;
      if (t.dataset.accept) {
        vscode.postMessage({ type: 'approval', id: id, accepted: true });
        lockCard(card, 'Accepted');
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
    planEl.style.display = 'block';
    const icon = { pending: '○', in_progress: '◐', completed: '●', failed: '✕' };
    planEl.innerHTML = steps.map(function (s) {
      return '<div class="step"><span class="bullet s-' + s.status + '">' + (icon[s.status] || '○') + '</span>' +
        '<span class="s-' + s.status + '">' + esc(s.title) + '</span></div>';
    }).join('');
  }

  function send() {
    const text = inputEl.value.trim();
    if (!text || busy) { return; }
    inputEl.value = '';
    inputEl.style.height = 'auto';
    setBusy(true);
    current = null;
    planEl.style.display = 'none';
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
  $('btnSettings').addEventListener('click', function () { vscode.postMessage({ type: 'settings' }); });

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
        addCard('approval', msg.id, msg.req.title, msg.req.detail, msg.req.preview, msg.req.risk);
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
})();
</script>
</body>
</html>`;
}
