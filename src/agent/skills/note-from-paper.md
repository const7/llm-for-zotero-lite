---
id: note-from-paper
match: /\b(create|make|write|draft|generate)\b.*\b(note|summary note|reading note|notes?)\b.*\b(for|from|about|on)\b.*\b(paper|article|this)\b/i
match: /\b(note|notes?)\b.*\b(for|from|about|on)\b.*\b(paper|article|this|these)\b/i
match: /\b(reading notes?|study notes?|literature notes?|research notes?)\b/i
match: /\b(summarize|summarise)\b.*\b(into|as|to)\b.*\b(note|notes?)\b/i
---

## Writing Notes from Papers — read then write

When the user asks to create a note summarizing a paper or to generate reading
notes, follow this efficient two-step workflow.

### Recipe

**Step 1 — Read the paper:**
- If `mineruCacheDir` is available: use `file_io(read, '{mineruCacheDir}/full.md')`.
- Otherwise: use `inspect_pdf(operation:'front_matter')` for the overview, then optionally one `retrieve_evidence` call for key results/methods if the user wants detail beyond the abstract.

**Step 2 — Create the note:**
Call `edit_current_note(mode:'create')` with the note content. The user will
see a diff confirmation card.

### Key rules
- NEVER output the note text in chat. Always use `edit_current_note` so the user gets a diff review.
- Keep the read phase minimal: 1 call (MinerU) or 1–2 calls (inspect_pdf). Do not read the entire paper section by section.
- The user can ask for changes after seeing the confirmation card.

### Budget
Total tool calls: 2–3 (one read, optionally one more for detail, one note write).
