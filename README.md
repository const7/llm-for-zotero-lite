# llm-for-zotero-lite

A personal lean fork of `llm-for-zotero`, based on
commit [`a705f69`](https://github.com/const7/llm-for-zotero-lite/commit/a705f69c2569a329d3837e8abae5345de56b0aae).

This fork is intentionally focused on one workflow: chatting with the current
paper in Zotero's side panel.

## Current Scope

The main supported path is paper chat with:

- current paper context, selected text, reference context, and prompt presets
- API / Codex App Server / GitHub Copilot providers
- WebChat provider path
- MinerU cache/manual parsing when useful for paper chat

Agent workflows, standalone windows, note/export workflows, and unrelated
background jobs have been removed from the product surface.

## Main Changes

- Slimmed startup so only paper-chat essentials initialize by default.
- Reworked the side panel around a single paper-chat path.
- Optimized long-history rendering, conversation switching, and response-end
  updates to reduce Zotero UI stalls.
- Added lightweight prompt presets and a hover timeline for jumping between
  questions.
- Kept WebChat and MinerU off the hot path unless explicitly used.
- Simplified preferences, docs, tests, and release flow for this lite fork.

## Install

Download the `.xpi` from GitHub Releases, then install it in Zotero via
`Tools -> Add-ons -> Install Add-on From File...`.

This fork uses its own addon identity:

- name: `llm-for-zotero-lite`
- id: `zotero-llm-lite@github.com.const7`
- prefs: `extensions.zotero.llmforzoterolite`

## Configure

Open `Preferences -> llm-for-zotero-lite`, configure a provider/model, then use
`Test Connection`.

## Development

```bash
npm install
npm start
npm run test
npm run lint:check
npm run build
```

`npm run test:zotero` is kept for explicit Zotero-runner integration checks.

## Release

GitHub Actions can build releases automatically. Push a tag matching `v*` to
trigger `.github/workflows/release.yml`, which builds the plugin and uploads the
release artifact.

## Codex paper chat

Paper context labels indicate the content source. **Text** sends extracted text
without the paper's images; add a figure screenshot when visual analysis is
needed. **PDF** uses the provider's PDF input path; with Codex App Server, the
plugin renders the PDF pages as images in a hidden browser without opening or
scrolling reader tabs, and sends them as image input instead of uploading the
PDF file. In Text mode, right-click the paper chip to switch
between full-text and retrieval modes.

Install the Codex CLI and run `codex login`, then select **Codex App Server**
in the provider settings. Available models load automatically from `model/list`;
choose the default model from the dropdown, or use the refresh icon beside it
to reload the list. The chat model selector lists all discovered Codex models
directly. In the chat panel, choose **low**, **medium**, or **high** from the model's supported reasoning
levels. The last successful model catalog is cached; failed refreshes preserve
it and show an error. Each request checks the current server catalog before
starting a chat. You can use **Test Connection** to test the selected model. If
Zotero cannot find the executable, set its absolute path in the same card
(e.g. `/opt/homebrew/bin/codex` on Apple Silicon). On Windows, point to the
native `codex.exe`, not an npm `.cmd` launcher.

Codex CLI 0.153.4 is the validated version. This integration requires
`model/list`, `thread/start` with confirmed `ephemeral: true`, and
`thread/inject_items`.
Older servers fail explicitly instead of silently creating persistent sessions.

Each request starts a private app-server process over asynchronous stdio,
creates an ephemeral thread, injects the prepared local history with its original
roles, and sends the current question and images. Completion, cancellation, and
plugin shutdown close the owned process. No Codex thread IDs are persisted;
these sessions do not enter Codex's stored task list. This is a local history
policy, not a claim about provider-side data retention.

Zotero remains the source of conversation history, so reopening a paper and
retrying or editing a question still work. Existing Codex Auth provider settings
are normalized to App Server while preserving model and conversation identities.
The plugin no longer reads or refreshes Codex credentials itself. API URL, API
key, temperature, and max-output controls do not apply to this backend. Model
selection, the chat reasoning selector, and the input context cap still apply.

Paper text and page images use the existing context preparation path. Binary
file uploads, MCP, shell tools, and interactive approvals are outside this paper
chat integration. History storage and context-budget limits remain local to the plugin. Both new
questions and retries use the same token-budget policy; older turns are no longer
replaced by fixed-length excerpts after ten exchanges.

### Local file storage

Plugin files are stored under `<Zotero data directory>/llm-for-zotero-lite/`:

- `attachments/`: New chat attachments, deduplicated by content hash.
- `cache/embeddings/`: Cached paper embeddings.
- `cache/mineru/`: MinerU output, including `full.md`, images, and a manifest
  for each item.
- `codex/`: The Codex app-server working directory.

Chat history and attachment references remain in the Zotero database. The plugin
uses only this storage directory and does not search legacy locations. Existing
files and database paths must be migrated once before upgrading.
