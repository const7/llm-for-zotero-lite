# llm-for-zotero-lite

A personal lean fork of `llm-for-zotero`, based on
commit [`a705f69`](https://github.com/const7/llm-for-zotero-lite/commit/a705f69c2569a329d3837e8abae5345de56b0aae).

This fork is intentionally focused on one workflow: chatting with the current
paper in Zotero's side panel.

## Current Scope

The main supported path is paper chat with:

- current paper context, selected text, reference context, and prompt presets
- API / Codex Auth / GitHub Copilot providers
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
