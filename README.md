# llm-for-zotero-lite

Personal lean fork of `llm-for-zotero`, focused on one primary workflow:
chat with the current paper inside the Zotero side panel, with lower UI and
startup overhead than the upstream full-featured plugin.

## What This Fork Optimizes For

- fast startup
- responsive paper selection and panel hydration
- smooth send / stream / response completion flow
- paper-scoped chat as the default and primary path

This branch intentionally trims or de-emphasizes product surface that is not
needed for that path.

## Current Scope

Core workflow kept:

- open a paper in Zotero
- ask questions in the reader side panel
- stream answers
- keep paper conversation history
- use current-paper context, retrieval, screenshots, and file attachments

Still available but not treated as hot-path features:

- webchat
- MinerU manual parsing / cache
- note export

Not a priority for this fork:

- agent-centric workflows
- standalone-first usage
- template-style product surface inherited from upstream

## Installation

1. Download the latest `.xpi` from your releases page.
2. In Zotero, open `Tools -> Add-ons`.
3. Choose `Install Add-on From File...`.
4. Restart Zotero.

The addon identity in this fork is isolated from upstream:

- addon name: `llm-for-zotero-lite`
- addon id: `zotero-llm-lite@github.com.kun`
- prefs prefix: `extensions.zotero.llmforzoterolite`

## Configuration

Open `Preferences -> llm-for-zotero-lite`.

Set only the essentials:

- provider
- API base URL
- API key / secret
- model

Then click `Test Connection`.

## Daily Use

1. Open a PDF in Zotero.
2. Open the side panel.
3. Ask a question about the current paper.

The intended behavior is:

- first turn can use full paper context
- follow-up turns stay paper-scoped
- long histories should not block normal Zotero interactions

## Development

### Requirements

- Node.js
- Zotero

### Common commands

```bash
npm install
npm start
npm run typecheck
npm run test:unit
npm run build
```

## Release

This repo is already set up for automated GitHub releases.

- CI: `.github/workflows/ci.yml`
- release workflow: `.github/workflows/release.yml`
- release command: `npm run release`

The release workflow runs when you push a tag matching `v*`.

Typical flow:

```bash
npm run build
git tag v1.0.0
git push origin main --tags
```

If the repository metadata in `package.json` points to your fork, generated
update metadata and release links will also point to your fork.

## Notes For This Fork

- README and docs are intentionally short and aligned to the lean profile.
- If a feature exists in code but is not documented here, it should be treated
  as secondary / cold-path behavior rather than the main product surface.
- This fork is not trying to maintain upstream feature parity.
