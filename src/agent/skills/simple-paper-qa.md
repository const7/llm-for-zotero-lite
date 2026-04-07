---
id: simple-paper-qa
match: /\b(what|who|when|where|which|tell me|explain)\b.*\b(about|paper|article|study|wrote|author|publish|year|journal|abstract|topic|field|contribution|finding|claim|conclusion|argue)\b/i
match: /\bsummar(y|ize|ise)\b/i
match: /\b(what is|what are|what does|what do)\b.*\b(this paper|this article|this study|the paper|the article)\b/i
match: /\b(main|key|central|primary|core)\b.*\b(finding|result|contribution|argument|claim|conclusion|point|idea|theme|message|takeaway)\b/i
match: /\b(tldr|tl;dr|gist|overview|brief)\b/i
---

## Simple Paper Q&A — one read, then answer

When the user asks a general question about a paper (topic, authors, summary,
main findings, conclusions, field, contribution), you usually need only ONE
tool call, then answer.

### Recipe

**Step 1 — Read the paper once:**
- If `mineruCacheDir` is available: use `file_io(read, '{mineruCacheDir}/full.md')`. This gives you the entire parsed paper including abstract, introduction, and conclusions.
- If no MinerU cache: use `inspect_pdf(operation:'front_matter')` for the paper. This returns the abstract, authors, and introduction — enough for most general questions.

**Step 2 — Answer immediately.**
Do NOT call `retrieve_evidence`, `read_chunks`, or any other tool unless the
front matter genuinely does not contain the answer. For questions like "what is
this about?", "who are the authors?", "summarize this paper", the front matter
or MinerU markdown is sufficient.

### When to escalate
If (and only if) the user asks about something specific that the front matter
does not cover (a particular experiment, a specific table, a named method, a
result in a specific section), then make ONE targeted `retrieve_evidence` call
and answer from that. Do not read the whole paper.
