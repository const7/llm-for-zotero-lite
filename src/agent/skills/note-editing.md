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
- Always pass plain text or Markdown, never raw HTML.
