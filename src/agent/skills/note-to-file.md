---
id: note-to-file
name: Save Note to File
description: Write notes to a local directory as Markdown, Org-mode, or any text format
version: 1
match: /\b(write|save|export|send)\b.*\bobsidian\b/i
match: /\bobsidian\b.*\b(note|write|save|export)\b/i
match: /\bto\s+obsidian\b/i
match: /\bobsidian\b.*\bvault\b/i
match: /\b(save|write|export)\b.*\bnote\b.*\b(to\s+)?(file|disk|local|directory|folder)\b/i
match: /\b(note|notes?)\b.*\b(to\s+)?(file|disk|local|directory|folder)\b/i
---

<!--
  SKILL: Save Note to File

  This skill activates when you ask the agent to save a note as a file
  on your computer (e.g., "save note to file", "export as org-mode",
  "write to obsidian").

  You can customize:
  - TEMPLATE section below: change the note format (Markdown, Org-mode, LaTeX, etc.)
  - MATCH patterns above: add your own trigger phrases
  - RECIPE steps: adjust how the agent gathers content and writes files
  - Citation style: change between [@citekey], [cite:@citekey], etc.

  Your changes are preserved across plugin updates.
  To reset to default, delete this file — it will be recreated on next restart.
-->

## Writing Notes to File

When the user asks to write, save, or export content to a local file, follow this workflow.
This skill is content-agnostic — it works for any note type: single paper summary, literature review, multi-paper comparison, research notes, or free-form writing.

### Prerequisites
- The user's notes directory path and default folder are provided in the system prompt under "Notes directory configuration". If missing, tell the user to configure the notes directory in the plugin preferences (Settings > Agent tab).
- The default folder is used when the user doesn't specify a folder. If the user specifies a different folder, write there instead.

### Template

Apply the note template provided elsewhere in this prompt (from the Note Template skill).
If no template instructions are present, use this minimal fallback:

```
# {{title}}

{{content}}
```

### Recipe

**Step 1 — Gather content:**
- For a single paper: read via `file_io(read, '{mineruCacheDir}/full.md')` if MinerU available, otherwise `read_paper`.
- For multi-paper notes (reviews, comparisons): use `query_library` + `read_paper`/`file_io` for each paper.
- For free-form notes: use whatever the user provides or requests.

**Step 2 — Look up citation keys (if citing papers):**
- Use `read_library(sections:['metadata'])` to get the `citationKey` (or `citekey`) for each referenced paper.
- In the note body, cite papers using **Pandoc citation syntax**: `[@citekey]` (e.g., `[@smith2024deep]`).
- Adapt citation syntax to the target format if needed (e.g., `[cite:@citekey]` for Org-mode).
- Optionally add a `## References` section at the end listing full citations.

**Step 3 — Compose the note:**
- Use the note template as the skeleton (from the Note Template skill, or the fallback above if unavailable).
- Fill in `{{title}}` with the note title (paper title, review topic, or user-provided title).
- Fill in `{{date}}` with today's date in YYYY-MM-DD format.
- Fill in `{{content}}` with the full note body.
- Add extra YAML frontmatter fields as appropriate for the content type (e.g., `authors`, `doi`, `journal` for paper notes; nothing extra for free-form).

**Step 4 — Include figures (when appropriate and MinerU cache is available):**
- The MinerU cache contains extracted figures in `{mineruCacheDir}/images/`.
- When figures would add value to the note (e.g., result plots, diagrams, key tables), copy and include them.
- Use `run_command` to copy needed image files from `{mineruCacheDir}/images/` to `{notesDirectoryPath}/{folder}/{attachmentsFolder}/{sanitized-title}/` (use the native path separator from the runtime platform section in the system prompt).
- Reference copied images with relative paths: `![Figure caption]({attachmentsFolder}/{sanitized-title}/fig1.png)`.
- Use judgement: a detailed paper analysis benefits from figures; a quick free-form note may not.

**Step 5 — Write the note file:**
- Construct the file path: `{notesDirectoryPath}/{folder}/{sanitized-title}.md` (use the native path separator from the runtime platform section in the system prompt).
- Sanitize the title for filesystem use: replace special characters with hyphens, limit to 80 chars.
- Call `file_io(write, filePath, noteContent)`.

### Key rules
- Always use `file_io` for writing — never output the full note text in chat.
- Use the note template from the Note Template skill. If unavailable, use the fallback template in this skill.
- Use `[@citekey]` Pandoc syntax when referencing papers — look up citekeys from Zotero metadata. Adapt citation syntax to the target format.
- If writing fails, report the error clearly with the attempted path.
- Use the native path separator provided in the runtime platform section of the system prompt. Never mix separators.

### Budget
Total tool calls: 2–5 (read content, optionally look up citekeys, optionally copy images, write note file).
