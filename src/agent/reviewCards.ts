import type {
  AgentConfirmationResolution,
  AgentModelMessage,
  AgentInheritedApproval,
  AgentPendingAction,
  AgentPendingField,
  AgentToolContext,
  AgentToolReviewResolution,
  AgentToolResult,
} from "./types";
import { normalizeNoteSourceText } from "../modules/contextPanel/notes";

type SearchLiteratureOnlineMode =
  | "recommendations"
  | "references"
  | "citations"
  | "search"
  | "metadata";

type SearchLiteratureOnlineSource = "openalex" | "arxiv" | "europepmc";

type SearchReviewPaper = {
  rowId: string;
  title: string;
  subtitle?: string;
  body?: string;
  badges?: string[];
  href?: string;
  importIdentifier?: string;
  raw: Record<string, unknown>;
};

type SearchReviewMetadataRow = {
  key: string;
  label: string;
  before?: string;
  after: string;
  multiline?: boolean;
};

type SearchReviewPrepared =
  | {
      kind: "paper_results";
      mode: Exclude<SearchLiteratureOnlineMode, "metadata">;
      source?: string;
      query?: string;
      papers: SearchReviewPaper[];
    }
  | {
      kind: "metadata";
      mode: "metadata";
      rows: SearchReviewMetadataRow[];
      noteContent: string;
    };

type SearchReviewArgs = {
  mode?: SearchLiteratureOnlineMode;
  source?: SearchLiteratureOnlineSource;
  limit?: number;
  libraryID?: number;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function bareDoi(value: unknown): string | undefined {
  const doi = readString(value);
  if (!doi) return undefined;
  return doi.replace(/^https?:\/\/doi\.org\//i, "");
}

function maybeArxivIdentifier(url: unknown): string | undefined {
  const raw = readString(url);
  if (!raw) return undefined;
  const match = /arxiv\.org\/abs\/([\d.]+)/i.exec(raw);
  return match?.[1] ? `arxiv:${match[1]}` : undefined;
}

function buildImportIdentifier(result: Record<string, unknown>): string | undefined {
  const doi = bareDoi(result.doi);
  if (doi?.startsWith("10.")) return doi;
  return (
    maybeArxivIdentifier(result.sourceUrl) ||
    maybeArxivIdentifier(result.openAccessUrl)
  );
}

function buildPaperSubtitle(result: Record<string, unknown>): string | undefined {
  const year =
    typeof result.year === "number"
      ? String(result.year)
      : readString(result.year);
  const authors = Array.isArray(result.authors)
    ? result.authors
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .slice(0, 3)
    : [];
  const authorLabel =
    authors.length > 0
      ? `${authors.join(", ")}${Array.isArray(result.authors) && result.authors.length > 3 ? " et al." : ""}`
      : undefined;
  const parts = [year, authorLabel].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function buildPaperBadges(result: Record<string, unknown>): string[] | undefined {
  const badges: string[] = [];
  if (typeof result.citationCount === "number") {
    badges.push(
      `${result.citationCount.toLocaleString()} citation${
        result.citationCount === 1 ? "" : "s"
      }`,
    );
  }
  const doi = bareDoi(result.doi);
  if (doi) badges.push(`DOI: ${doi}`);
  return badges.length ? badges : undefined;
}

function describeMetadataResult(result: Record<string, unknown>): string {
  const title = readString(result.title) || "Untitled result";
  const authors = Array.isArray(result.authors)
    ? result.authors
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .slice(0, 4)
        .join(", ")
    : "";
  const year =
    typeof result.year === "number"
      ? String(result.year)
      : readString(result.year) || "";
  const venue = readString(result.venue) || "";
  const abstract = readString(result.abstract) || "";
  return [title, [authors, year, venue].filter(Boolean).join(" · "), abstract]
    .filter(Boolean)
    .join("\n");
}

function getReferencePaperTitle(context: AgentToolContext): string | undefined {
  return (
    context.request.selectedPaperContexts?.[0]?.title ||
    context.request.fullTextPaperContexts?.[0]?.title ||
    context.request.pinnedPaperContexts?.[0]?.title ||
    context.item?.getDisplayTitle?.() ||
    undefined
  );
}

function buildPaperNoteTemplate(
  context: AgentToolContext,
  prepared: Extract<SearchReviewPrepared, { kind: "paper_results" }>,
): string {
  const paperTitle = getReferencePaperTitle(context) || "Current paper";
  const header = `## Related papers for ${paperTitle}`;
  const detail = [
    prepared.source ? `Source: ${prepared.source}` : null,
    prepared.mode ? `Mode: ${prepared.mode}` : null,
    prepared.query ? `Query: ${prepared.query}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const items = prepared.papers
    .map((paper) => {
      const doi = paper.importIdentifier?.startsWith("10.")
        ? ` DOI: ${paper.importIdentifier}`
        : "";
      return `- ${paper.title}${paper.subtitle ? ` (${paper.subtitle})` : ""}${doi}`;
    })
    .join("\n");
  return [header, detail, "", items].filter(Boolean).join("\n");
}

function buildMetadataNoteTemplate(
  context: AgentToolContext,
  rows: SearchReviewMetadataRow[],
): string {
  const paperTitle = getReferencePaperTitle(context) || "Current paper";
  return [
    `## External metadata for ${paperTitle}`,
    "",
    ...rows.map((row) => `- ${row.label}: ${row.after}`),
  ].join("\n");
}

function buildNoteDraftReviewFields(noteContent: string): AgentPendingField[] {
  return [
    {
      type: "diff_preview",
      id: "noteDiff",
      label: "Note changes",
      before: "",
      after: noteContent,
      sourceFieldId: "noteContent",
      contextLines: 2,
      emptyMessage: "No note content yet.",
      visibleForActionIds: ["save_note"],
    },
    {
      type: "textarea",
      id: "noteContent",
      label: "Final note content",
      value: noteContent,
      visibleForActionIds: ["save_note"],
      requiredForActionIds: ["save_note"],
    },
  ];
}

function prepareSearchReview(
  result: AgentToolResult,
): SearchReviewPrepared | null {
  if (!result.ok || !result.content || typeof result.content !== "object") {
    return null;
  }
  const content = result.content as Record<string, unknown>;
  const mode = readString(content.mode) as SearchLiteratureOnlineMode | undefined;
  const results = Array.isArray(content.results) ? content.results : [];
  if (!mode || results.length === 0) {
    return null;
  }

  if (mode === "metadata") {
    const rows: SearchReviewMetadataRow[] = [];
    for (const [index, entry] of results.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      rows.push({
        key: `metadata-${index + 1}`,
        label: readString(record.source) || `Result ${index + 1}`,
        before: readString(record.url) || bareDoi(record.doi),
        after: describeMetadataResult(record),
        multiline: true,
      });
    }
    if (!rows.length) return null;
    return {
      kind: "metadata",
      mode,
      rows,
      noteContent: "",
    };
  }

  const papers: SearchReviewPaper[] = [];
  for (const [index, entry] of results.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const title = readString(record.title);
    if (!title) continue;
    papers.push({
      rowId: `paper-${index + 1}`,
      title,
      subtitle: buildPaperSubtitle(record),
      body: readString(record.abstract),
      badges: buildPaperBadges(record),
      href: readString(record.openAccessUrl) || readString(record.sourceUrl),
      importIdentifier: buildImportIdentifier(record),
      raw: record,
    });
  }
  if (!papers.length) return null;
  return {
    kind: "paper_results",
    mode,
    source: readString(content.source),
    query: readString(content.query),
    papers,
  };
}

function getSearchActionButtons(kind: SearchReviewPrepared["kind"]) {
  if (kind === "metadata") {
    return [
      { id: "continue", label: "Continue", style: "primary" as const },
      {
        id: "save_note",
        label: "Save metadata as note",
        style: "secondary" as const,
        executionMode: "edit" as const,
        submitLabel: "Save metadata as note",
      },
      { id: "cancel", label: "Cancel", style: "secondary" as const },
    ];
  }
  return [
    { id: "import", label: "Import selected", style: "primary" as const },
    {
      id: "save_note",
      label: "Save selected as note",
      style: "secondary" as const,
      executionMode: "edit" as const,
      submitLabel: "Save selected as note",
    },
    {
      id: "new_search",
      label: "Search again",
      style: "secondary" as const,
      executionMode: "edit" as const,
      submitLabel: "Confirm search",
      backLabel: "Get back",
    },
    { id: "cancel", label: "Cancel", style: "secondary" as const },
  ];
}

function normalizeSelectedRowIds(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function buildContinueFollowup(
  prepared: SearchReviewPrepared,
  selectedCount: number,
): AgentModelMessage {
  const summary =
    prepared.kind === "paper_results"
      ? `The user reviewed the online literature results and approved ${selectedCount} selected paper${
          selectedCount === 1 ? "" : "s"
        } for the next step. Use only the approved results in the attached tool output.`
      : "The user reviewed the external metadata results and approved them for the next step.";
  return {
    role: "user",
    content: summary,
  };
}

function filterSelectedPapers(
  prepared: Extract<SearchReviewPrepared, { kind: "paper_results" }>,
  selectedIds: string[],
): SearchReviewPaper[] {
  const selected = new Set(selectedIds);
  return prepared.papers.filter((paper) => selected.has(paper.rowId));
}

function normalizeSearchReviewArgs(args: unknown): SearchReviewArgs {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  const record = args as Record<string, unknown>;
  return {
    mode: readString(record.mode) as SearchLiteratureOnlineMode | undefined,
    source: readString(record.source) as SearchLiteratureOnlineSource | undefined,
    limit: readPositiveInt(record.limit),
    libraryID: readPositiveInt(record.libraryID),
  };
}

export function createSearchLiteratureReviewAction(
  result: AgentToolResult,
  context: AgentToolContext,
  args: unknown,
): AgentPendingAction | null {
  const prepared = prepareSearchReview(result);
  if (!prepared) return null;
  if (prepared.kind === "metadata") {
    const noteContent = buildMetadataNoteTemplate(context, prepared.rows);
    return {
      toolName: "search_literature_online",
      mode: "review",
      title: "Review external metadata",
      description:
        "Review the metadata below. Continue to use it in the agent flow, save it to a note, or stop here.",
      confirmLabel: "Continue",
      cancelLabel: "Cancel",
      actions: getSearchActionButtons(prepared.kind),
      defaultActionId: "continue",
      cancelActionId: "cancel",
      fields: [
        {
          type: "review_table",
          id: "metadataResults",
          label: "Metadata results",
          rows: prepared.rows,
        },
        ...buildNoteDraftReviewFields(noteContent),
      ],
    };
  }

  const normalizedArgs = normalizeSearchReviewArgs(args);
  const noteContent = buildPaperNoteTemplate(context, prepared);
  return {
    toolName: "search_literature_online",
    mode: "review",
    title: "Review online literature results",
    description:
      "Select the papers you want to import or save to a note, or refine with a follow-up search.",
    confirmLabel: "Import selected",
    cancelLabel: "Cancel",
    actions: getSearchActionButtons(prepared.kind),
    defaultActionId: "import",
    cancelActionId: "cancel",
    fields: [
      {
        type: "paper_result_list",
        id: "selectedPaperIds",
        label: "Search results",
        rows: prepared.papers.map((paper) => ({
          id: paper.rowId,
          title: paper.title,
          subtitle: paper.subtitle,
          body: paper.body,
          badges: paper.badges,
          href: paper.href,
          importIdentifier: paper.importIdentifier,
          checked: true,
        })),
        minSelectedByAction: [
          { actionId: "import", min: 1 },
          { actionId: "save_note", min: 1 },
        ],
        visibleForActionIds: ["import", "save_note"],
      },
      ...buildNoteDraftReviewFields(noteContent),
      {
        type: "text",
        id: "nextQuery",
        label: "Next search query",
        value: prepared.query || getReferencePaperTitle(context) || "",
        visibleForActionIds: ["new_search"],
        requiredForActionIds: ["new_search"],
      },
      {
        type: "select",
        id: "nextSource",
        label: "Search source",
        value: normalizedArgs.source || "openalex",
        options: [
          { id: "openalex", label: "OpenAlex" },
          { id: "arxiv", label: "arXiv" },
          { id: "europepmc", label: "Europe PMC" },
        ],
        visibleForActionIds: ["new_search"],
        requiredForActionIds: ["new_search"],
      },
      {
        type: "text",
        id: "nextLimit",
        label: "Result limit",
        value: String(normalizedArgs.limit || 10),
        visibleForActionIds: ["new_search"],
        requiredForActionIds: ["new_search"],
      },
    ],
  };
}

export function resolveSearchLiteratureReview(
  input: SearchReviewArgs,
  result: AgentToolResult,
  resolution: AgentConfirmationResolution,
  context: AgentToolContext,
): AgentToolReviewResolution {
  const prepared = prepareSearchReview(result);
  const normalizedArgs = input;
  const actionId = resolution.actionId || (resolution.approved ? "continue" : "cancel");
  const data =
    resolution.data && typeof resolution.data === "object" && !Array.isArray(resolution.data)
      ? (resolution.data as Record<string, unknown>)
      : {};

  if (!prepared || !resolution.approved || actionId === "cancel") {
    return {
      kind: "stop",
      finalText: "Stopped after review.",
    };
  }

  if (prepared.kind === "metadata") {
    if (actionId === "save_note") {
      const noteContent = normalizeNoteSourceText(
        readString(data.noteContent) || buildMetadataNoteTemplate(context, prepared.rows),
      );
      return {
        kind: "invoke_tool",
        call: {
          name: "mutate_library",
          arguments: {
            operations: [{ type: "save_note", content: noteContent, target: "item" }],
          },
          inheritedApproval: {
            sourceToolName: "search_literature_online",
            sourceActionId: "save_note",
            sourceMode: "review",
          } satisfies AgentInheritedApproval,
        },
        terminalText: {
          onSuccess: "Saved the reviewed metadata to a note.",
          onDenied: "Saving the metadata note was cancelled.",
          onError: "Could not save the reviewed metadata to a note.",
        },
      };
    }
    return {
      kind: "deliver",
      toolMessageContent: result.content,
      followupMessages: [buildContinueFollowup(prepared, prepared.rows.length)],
    };
  }

  const selectedIds = normalizeSelectedRowIds(data.selectedPaperIds);
  const selectedPapers = filterSelectedPapers(prepared, selectedIds);

  if (actionId === "import") {
    const identifiers = Array.from(
      new Set(
        selectedPapers
          .map((paper) => paper.importIdentifier)
          .filter((entry): entry is string => Boolean(entry)),
      ),
    );
    if (!identifiers.length) {
      return {
        kind: "stop",
        finalText: "No selected papers had an importable identifier.",
      };
    }
    return {
      kind: "invoke_tool",
      call: {
        name: "mutate_library",
        arguments: {
          operations: [
            {
              type: "import_identifiers",
              identifiers,
              libraryID: normalizedArgs.libraryID || context.request.libraryID,
            },
          ],
        },
        inheritedApproval: {
          sourceToolName: "search_literature_online",
          sourceActionId: "import",
          sourceMode: "review",
        } satisfies AgentInheritedApproval,
      },
      terminalText: {
        onSuccess: "Imported the selected papers into Zotero.",
        onDenied: "Importing the selected papers was cancelled.",
        onError: "Could not import the selected papers.",
      },
    };
  }

  if (actionId === "save_note") {
    const noteContent = normalizeNoteSourceText(
      readString(data.noteContent) || buildPaperNoteTemplate(context, prepared),
    );
    return {
      kind: "invoke_tool",
      call: {
        name: "mutate_library",
        arguments: {
          operations: [{ type: "save_note", content: noteContent, target: "item" }],
        },
        inheritedApproval: {
          sourceToolName: "search_literature_online",
          sourceActionId: "save_note",
          sourceMode: "review",
        } satisfies AgentInheritedApproval,
      },
      terminalText: {
        onSuccess: "Saved the selected papers to a note.",
        onDenied: "Saving the selected papers to a note was cancelled.",
        onError: "Could not save the selected papers to a note.",
      },
    };
  }

  if (actionId === "new_search") {
    return {
      kind: "invoke_tool",
      call: {
        name: "search_literature_online",
        arguments: {
          mode: "search",
          query:
            readString(data.nextQuery) ||
            prepared.query ||
            getReferencePaperTitle(context) ||
            context.request.userText,
          source:
            (readString(data.nextSource) as SearchLiteratureOnlineSource | undefined) ||
            normalizedArgs.source ||
            "openalex",
          limit: Math.min(
            25,
            Math.max(1, readPositiveInt(data.nextLimit) || normalizedArgs.limit || 10),
          ),
          libraryID: normalizedArgs.libraryID || context.request.libraryID,
        },
      },
    };
  }

  return {
    kind: "stop",
    finalText: "Stopped after review.",
  };
}
