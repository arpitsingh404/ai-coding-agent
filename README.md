# AI Coding Agent — VS Code Extension

An agentic AI software engineer inside VS Code. Chat in **English, Hindi or Hinglish**; the agent reads your project, writes real files, runs commands, reads the errors and fixes them.

Not a chatbot that prints code — it edits your workspace, with your approval on every risky step.

> **New in 0.3.0:** persistent memory (`remember` / `recall` / `forget` tools + commands), multi-message queue (send while the agent is working), fixed task/plan tracker with progress bar, and 8 new memory tests.
>
> **0.2.0:** slash commands, `@file` / `@selection` context, "Always allow" approvals, undo-all, live token meter, project rules (`AGENTS.md`), persistent chat history, deep-link task triggering and a marketplace icon.

---

## Features

**Chat**
- Premium chat panel in the Activity Bar (webview, matches VS Code theme, light + dark)
- Streaming responses, Markdown + syntax-highlighted code blocks + copy buttons
- Conversation history with automatic context trimming
- Ask mode (read-only) and Agent mode (can edit + run commands)
- Live activity indicator ("Reading src/app.ts", "Running npm test")
- Task plan with pending / in-progress / completed / failed states
- Stop button and full cancellation support

**Real code editing**
- Multi-file create / edit / delete with `write_file`, `apply_edit`, `delete_file`
- Surgical string replacement that fails loudly instead of silently corrupting files
- Unified diff preview before you approve a change
- Every change recorded → *Undo Last Agent Change* and *Review Changes*

**Terminal + verification**
- Runs commands with output capture (stdout/stderr/exit code/timeout)
- Long-running dev servers tracked with URLs and stop/restart controls
- Auto-detects package manager, framework and the right commands (`package.json`, lockfiles, `pyproject.toml`, `go.mod`, `Cargo.toml`)
- Reads the VS Code Problems panel through `get_diagnostics`

**Codebase understanding**
- Workspace discovery that respects `.gitignore`, your exclude globs and secret patterns
- Relevance-ranked context selection (never dumps the whole repo)
- Byte-budgeted context, auto-trimmed history
- Framework and dependency detection

**Security**
- API keys in VS Code **SecretStorage** (never in settings, logs or the webview)
- Hard block list for destructive commands (`rm -rf /`, `mkfs`, `dd of=/dev/*`, fork bombs, `curl | bash`, force-push, publish…)
- Risk classification (low / medium / high) drives the approval UI
- Path guard: every operation is confined to the workspace root
- Secret files (`.env`, `*.pem`, `id_rsa*`, …) are never read or sent to the model
- Ask mode physically cannot call write/execute tools

---

## Install

### From source (development)

```bash
git clone <your-repo> ai-coding-agent
cd ai-coding-agent
npm install
npm run build
```

Then press **F5** in VS Code (Run Extension) or package it:

```bash
npm run package          # produces ai-coding-agent-0.1.0.vsix
code --install-extension ai-coding-agent-0.1.0.vsix
```

### From the packaged VSIX

```bash
code --install-extension ai-coding-agent-0.1.0.vsix
```

---

## Configure

1. Open the **AI Coding Agent** icon in the Activity Bar.
2. `Ctrl+Shift+P` → **AI Coding Agent: Set API Key** (stored in SecretStorage).
3. Pick a provider in settings (`Ctrl+,` → search `aiCodingAgent`).

| Setting | Default | Notes |
|---|---|---|
| `aiCodingAgent.provider` | `openai` | `openai`, `anthropic`, `gemini`, `ollama`, `custom` |
| `aiCodingAgent.model` | provider default | e.g. `gpt-4o-mini`, `claude-sonnet-4-5`, `gemini-2.5-flash`, `qwen2.5-coder:7b` |
| `aiCodingAgent.baseUrl` | provider default | Any OpenAI-compatible endpoint |
| `aiCodingAgent.temperature` | `0.2` | |
| `aiCodingAgent.maxTokens` | `4096` | |
| `aiCodingAgent.maxIterations` | `25` | Agent tool-loop cap |
| `aiCodingAgent.requireApprovalForEdits` | `true` | Ask before writing files |
| `aiCodingAgent.requireApprovalForCommands` | `true` | Ask before running commands |
| `aiCodingAgent.maxContextFiles` | `40` | |
| `aiCodingAgent.maxContextBytes` | `200000` | |
| `aiCodingAgent.excludeGlobs` | node_modules, dist, … | |
| `aiCodingAgent.secretFilePatterns` | `.env`, `*.pem`, … | Never sent to the model |
| `aiCodingAgent.commandTimeoutMs` | `120000` | |

Provider defaults:

| Provider | Base URL | Example model |
|---|---|---|
| openai | `https://api.openai.com/v1` | `gpt-4o-mini` |
| anthropic | `https://api.anthropic.com` | `claude-sonnet-4-5` |
| gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| ollama | `http://localhost:11434/v1` | `qwen2.5-coder:7b` |
| custom | yours | anything OpenAI-compatible |

---

## Commands & shortcuts

| Command | Shortcut |
|---|---|
| AI Coding Agent: Open Chat | `Ctrl+Alt+A` |
| Ask About Current File | `Ctrl+Alt+Q` |
| Edit Selected Code | `Ctrl+Alt+K` |
| Explain Error (picks from Problems) | `Ctrl+Alt+X` |
| Fix Current File | — |
| Run Project | — |
| Run Tests | — |
| Review Changes | — |
| Undo Last Agent Change | — |
| Undo All Agent Changes | — |
| Stop Agent | `Ctrl+Alt+S` |
| New Chat / Clear Chat | — |
| Set / Clear API Key | — |

### Slash commands (inside the chat)

| Command | What it does |
|---|---|
| `/help` | show all commands |
| `/explain [file]` | explain code (read-only) |
| `/fix [file]` | fix diagnostics in a file |
| `/test` | run the project test command |
| `/run` | start the dev server |
| `/plan <task>` | plan first, then execute |
| `/clear` | new chat |

### Context references

- `@src/app/page.tsx` — attach that file to the message
- `@selection` — attach the current editor selection (file + line range)

### Project rules

Put an `AGENTS.md` (or `.ai-agent.md`, `.cursorrules`, `.github/copilot-instructions.md`) at the workspace root. Its contents are injected into the system prompt for every request — house style, stack rules, do-not-touch list, etc.

### Memory

The agent has its own persistent memory (survives reloads and works across projects):

- It calls `remember` when you state a durable preference/fact ("use pnpm", "deploy target is vclub.tech", "reply in Hinglish").
- Relevant memories are injected into the system prompt automatically.
- `recall` searches memory on demand, `forget` removes an entry.
- Commands: **AI Coding Agent: Show Memory** (add / delete) and **Clear Memory**.

### Message queue

You can keep typing while the agent works — the composer switches to **Queue**. Queued messages are sent automatically, in order, as soon as the current turn finishes. **Stop** cancels only the running turn.

### Deep link

Start a task from anywhere:

```
vscode://arpit-singh.ai-coding-agent/run?mode=agent&prompt=Build%20a%20login%20page
```

---

## How a task flows

```
You: "Mere project mein login page banao"
  → get_project_info      detect Next.js + npm, learn real scripts
  → update_plan           plan shown in the panel
  → list_files / read_file / search_files
  → write_file / apply_edit        (diff + approval card)
  → run_command npm run build      (approval, risk-classified)
  → get_diagnostics                read real compiler errors
  → apply_edit …                   targeted fixes
  → run_command again              verify
  → summary: files changed, how to use it, what remains unverified
```

The agent stops after `maxIterations` and asks you to continue — no infinite loops.

---

## Architecture

```
src/
  extension.ts          activation, commands, status bar
  config/settings.ts    typed config + SecretStorage
  providers/            openai-compatible + anthropic (streaming, tool calling)
  agent/agent.ts        the tool loop, history, cancellation, system prompt
  agent/tools.ts        tool schemas + execution + approval plumbing
  workspace/files.ts    discovery, read/write/edit/delete, search, project info
  workspace/pathGuard.ts  pure path confinement (unit tested)
  workspace/changes.ts  change history, undo, diff provider
  terminal/runner.ts    command execution + dev-server tracking
  debug/diagnostics.ts  Problems panel integration
  context/ignore.ts     globs, .gitignore, relevance scoring (unit tested)
  context/context.ts    context budget + selection
  util/diff.ts          LCS line diff (unit tested)
  webview/panel.ts      webview ↔ agent bridge, approvals
  webview/ui.ts         chat UI (CSP + nonce, VS Code theme vars)
  tests/                node:test suites
```

**Security boundary:** the webview can only send `send / stop / approval / mode / settings`. Everything privileged happens in the extension host; every path is resolved and validated before touching disk.

---

## Testing

```bash
npm test        # builds, then runs node:test suites (28 assertions)
npm run lint    # type-check only
```

Covered: path traversal, secret detection, destructive-command blocking, risk classification, project-command detection, glob/.gitignore matching, relevance ranking, diff correctness.

---

## Packaging

```bash
npm run package
# ai-coding-agent-0.1.0.vsix
```

---

## Known limitations (honest list)

- **Embeddings / semantic index are not implemented.** Context uses relevance scoring + file structure, not a vector DB.
- **No inline ghost-text completion.** This is a chat/agent tool, not a tab-completion engine.
- **Terminal output is captured via `child_process`**, mirrored to the *AI Coding Agent — Terminal* output channel, rather than injected into a VS Code terminal (needed for reliable stdout capture). Long-running servers are tracked separately.
- **Debug sessions** are not auto-started; the agent reads diagnostics and stack traces, and explains them, but does not attach the debugger.
- **Tool calling depends on the model.** Small local models may ignore tools; `qwen2.5-coder` / `gpt-4o` / `claude-sonnet` work best.
- **Context is character-budgeted, not token-counted** — conservative defaults keep requests small.
- **No multi-root workspace support yet**; the first workspace folder is used.
- **Approval is per-action**, not per-session — intentional.

---

## Privacy

- **No backend of ours.** Requests go straight from the user's VS Code to the AI provider they configured (OpenAI / Anthropic / Gemini / DeepSeek / local Ollama). Nothing passes through the author.
- **Keys are per-user.** Each user stores their own key with *AI Coding Agent: Set API Key*, saved in VS Code **SecretStorage** (OS-encrypted). The extension ships with **no key** and never transmits one anywhere except the provider's own API.
- **What leaves the machine:** the prompt, the selected files' contents (minus secrets/ignored paths) and tool results, sent to the configured provider. Users who need full privacy should point `aiCodingAgent.baseUrl` at a local model (Ollama).
- **What is never sent:** `.env`, `*.pem`, `*.key`, `id_rsa*`, and anything matching `aiCodingAgent.secretFilePatterns`.
- **Local data:** chat transcript + memory live in the extension's `globalState` on the user's machine and can be cleared any time.

## License

MIT — the full text is in the bundled `LICENSE` file.

