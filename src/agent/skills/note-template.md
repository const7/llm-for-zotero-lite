---
id: note-template
description: Default note structure — customize this to shape all your notes
version: 1
match: /\b(create|make|write|draft|generate)\b.*\b(note|notes?)\b/i
match: /\b(note|notes?)\b.*\b(for|from|about|on)\b/i
match: /\b(save|write|append|add)\b.*\b(to\s+)?(note|notes?)\b/i
match: /\b(reading notes?|study notes?|literature notes?|research notes?)\b/i
match: /\b(use|apply|with)\b.*\btemplate\b/i
---

<!--
  SKILL: Note Template

  This skill provides a default note structure for the agent to follow
  when creating any kind of note (Zotero notes or file-based notes).

  OUT OF THE BOX: This skill is intentionally minimal. The agent will
  use its own judgment for note structure, just as it always has.

  TO CUSTOMIZE: Replace the "Template" section below with your preferred
  note structure. Once you do, the agent will follow your template for
  ALL notes — whether saved to Zotero or written to files.

  Example customizations:
  - Define sections: ## Summary, ## Methods, ## Key Findings, ## My Notes
  - Set a citation style: "Use [cite:@citekey] for all references"
  - Set a language: "Always write notes in Chinese"
  - Add frontmatter: YAML headers for Obsidian, Logseq, etc.
  - Change format: Org-mode, LaTeX, or any markup language

  Your changes are preserved across plugin updates.
  To reset to default, delete this file — it will be recreated on next restart.
-->

## Note Template

Use this template as the default structure for all notes you create, whether writing to Zotero (`edit_current_note`) or to files (`file_io`).

### Default template

```
---
title: "{{title}}"
date: {{date}}
tags: [zotero]
---

# {{title}}

{{content}}

---
*Written by LLM-for-Zotero*
```

### How to apply
- Fill in `{{title}}` with the note title (paper title, review topic, or user-provided title).
- Fill in `{{date}}` with today's date in YYYY-MM-DD format.
- Fill in `{{content}}` with the full note body.
- Add extra YAML frontmatter fields as appropriate (e.g., `authors`, `doi`, `journal` for paper notes).
- For Zotero notes (`edit_current_note`): omit the YAML frontmatter block (Zotero notes don't use frontmatter). Use the heading and content structure only.
- For file-based notes (`file_io`): include the full template with YAML frontmatter.

**If the user has replaced this template with their own, follow their template exactly for all notes you create — whether using `edit_current_note` (Zotero notes) or `file_io` (file-based notes).**
