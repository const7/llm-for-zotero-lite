---
id: note-editing
match: /\b(save|write|append|add|put)\b.*\b(to\s+)?(note|notes?)\b/i
match: /\b(note|notes?)\b.*\b(save|write|append|add)\b/i
match: /\b(edit|update|modify|rewrite|revise|polish)\b.*\b(note|notes?)\b/i
match: /\b(create|make|new)\b.*\bnote\b/i
---

## Note Editing Workflow

### Creating notes (mode: 'create')
- Notes are created directly without a confirmation card.
- In **paper chat** (active item exists): default to `target: 'item'` — attaches the note to the active paper.
- In **library chat** (no active item): default to `target: 'standalone'` — creates a standalone note.
- If the paper already has a single child note, the tool auto-appends your content with an `<hr/>` separator. Just call `edit_current_note(mode:'create')`.
- If the paper has **multiple** child notes and the user wants to append, ask which note to write to before proceeding.

### Editing existing notes (mode: 'edit')
- Edits always show a diff review card for the user to approve.
- PREFER `patches` (find-and-replace pairs) over `content` (full rewrite) — patches are faster.
- Use mode 'edit' for: append to specific position, insert, delete, rewrite sections.

### Key rules
- NEVER output note text in chat. Always use `edit_current_note`.
- Pass Markdown by default. When the user explicitly requests HTML output or provides an HTML template (e.g. Better Notes templates with inline styles), write HTML with inline styles directly. The original note HTML is available in the context when editing an existing note.

### Embedding figures from MinerU cache
When MinerU cache is available (`mineruCacheDir` in paper context), extracted figures can be embedded in notes:
- Use `![Caption](file:///{mineruCacheDir}/images/filename.png)`. The `edit_current_note` tool auto-imports `file://` images as Zotero attachments.
- Place figures inline near the relevant discussion, not clustered at the end.

**When the note explains or discusses a specific figure/table** (e.g., saving a figure analysis from chat), you **MUST** embed that figure's image. A note about "Figure 2" without showing Figure 2 is incomplete. Look in the conversation history for the `file_io` read of the figure image — use that file path.

For general notes (summaries, reading notes), include figures when they genuinely aid understanding. Use judgement.
