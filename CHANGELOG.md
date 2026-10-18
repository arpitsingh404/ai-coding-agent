# Changelog

## 0.2.0

### Added
- **Marketplace icon** — `media/icon.png` (256×256), gradient terminal mark.
- **Slash commands** in chat: `/help`, `/explain`, `/fix`, `/test`, `/run`, `/plan`, `/clear`.
- **`@file` and `@selection` references** — attach specific files or the current editor selection to a prompt.
- **"Always allow"** button on command approvals (per exact command, per session).
- **Undo All Agent Changes** command with confirmation.
- **Live token usage meter** (real usage from the provider when available, otherwise marked as estimate).
- **Project rules file support** — `AGENTS.md`, `.ai-agent.md`, `.cursorrules` or `.github/copilot-instructions.md` is injected into the system prompt.
- **Chat history persistence** across window reloads (transcript + model history, capped).
- **Deep link** `vscode://arpit-singh.ai-coding-agent/run?prompt=...&mode=agent` to start a task without typing.
- **Env-var API key fallback** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `CUSTOM_API_KEY` / `DEEPSEEK_API_KEY`).
- `view/title` menu buttons (New Chat, Settings).
- 16 commands total, smoke test covers activation + all commands.

### Changed
- Usage is accumulated across the whole tool loop, not per step.
- Panel state (mode, transcript) persisted in `globalState`.

### Fixed
- `realUsage` scoping bug that broke the usage estimate path.
- Chat panel survives a stubbed/absent `globalState` (defensive).

## 0.1.0

- Initial release: chat UI, OpenAI-compatible + Anthropic streaming providers, agent tool loop, multi-file editing with approvals and diffs, terminal execution, diagnostics, change tracking, ask/agent modes, 28 unit tests.

## 0.3.0

### Added
- **Persistent memory** — \emember\ / \ecall\ / \orget\ tools, keyword-ranked injection into the system prompt, and two commands (Show Memory, Clear Memory). Survives reloads, shared across workspaces, max 250 entries.
- **Multi-message queue** — send messages while the agent is running; the composer becomes "Queue" and queued messages auto-send in order after the current turn.
- **Plan progress bar** — task tracker now merges duplicate steps, shows \done/total\, highlights the active step and auto-scrolls to it.
- 8 memory unit tests (36 total).

### Fixed
- Plan list duplicated entries when the model re-published the same plan.
- Send button was disabled while busy, so follow-up messages were impossible.

## 0.4.0

### Added
- **⋯ menu in the chat header** — New chat, Chat history, Clear chat, Clear session, Memory, Settings in one place.
- **Saved chat sessions** — New Chat archives the previous conversation (up to 20). Reopen any past chat from *Chat History*; delete all history from the same picker.
- **Clear Session** command — wipes chat + model history + plan but keeps long-term memory.
- 20 commands total.

### Changed
- Clear Chat now clears without archiving; New Chat archives.

### Notes
- Session archive stores up to 40 messages per chat, newest 20 chats, in globalState.

## 0.5.0

### Added
- **\iCodingAgent.commandPolicy\** setting with three modes:
  - \strict\ (default) — catastrophic commands hard-blocked
  - \warn\ — nothing blocked, risky commands require approval
  - \off\ — no analysis at all, 100% free execution
- 4 new policy tests (40 total).

### Changed
- The safety analyser now takes the policy as an argument, so blocking can be tuned without touching code.

## 0.6.0

### Added
- **Model / provider picker in the chat header** — click the model chip to switch between DeepSeek, OpenAI, Anthropic, Gemini and local Ollama models without opening settings.
- **Quick actions** on the empty screen: Explain file, Fix errors, Run tests, Plan a feature.
- Polished header (gradient model chip with caret), grouped dropdowns, quick-action pills.

### Changed
- Selecting a model writes provider + model to the user settings immediately and refreshes the panel state.

## 1.0.0

First stable release.

### Highlights
- Agentic chat inside VS Code: read, plan, edit, run, debug, verify.
- Multi-file edits with diff previews, per-change approval, undo last / undo all.
- Terminal execution with output capture, long-running dev servers with URL detection.
- Diagnostics-driven fixing loop.
- Persistent memory (\emember\ / \ecall\ / \orget\), saved chat sessions, message queue.
- Model picker: DeepSeek, OpenAI, Anthropic, Gemini, local Ollama.
- Slash commands, \@file\ / \@selection\ context, project rules (\AGENTS.md\), deep links.
- Configurable safety policy: strict / warn / off.
- 40 unit tests, stubbed smoke test for activation + all commands.

### Packaging
- Publisher: arpit-singh
- Repository: https://github.com/arpitsingh404/ai-coding-agent
