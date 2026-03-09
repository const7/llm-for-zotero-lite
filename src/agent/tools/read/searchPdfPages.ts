import type { AgentToolDefinition } from "../../types";
import type { PdfPageService } from "../../services/pdfPageService";
import {
  buildPdfToolSchemaProperties,
  parsePdfTargetArgs,
  requireQuestionOrPages,
  type PdfTargetArgs,
} from "./pdfToolShared";

function isPdfVisualTask(userText: string, hasScreenshots: boolean): boolean {
  const normalized = userText.trim().toLowerCase();
  return (
    /\b(pdf|figure|equation|table|diagram|chart|graph|panel|page|layout)\b/.test(
      normalized,
    ) || hasScreenshots
  );
}

export function createSearchPdfPagesTool(
  pdfPageService: PdfPageService,
): AgentToolDefinition<PdfTargetArgs, unknown> {
  return {
    spec: {
      name: "search_pdf_pages",
      description:
        "Locate the most relevant PDF pages for a question, figure, equation, or explicit page request. Use this before sending PDF pages to the model.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: buildPdfToolSchemaProperties(),
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    guidance: {
      matches: (request) =>
        isPdfVisualTask(
          request.userText || "",
          Array.isArray(request.screenshots) &&
            request.screenshots.some((entry) => Boolean(entry)),
        ),
      instruction: [
        "When the user asks about a figure, equation, table, page layout, or any PDF-specific visual detail, use the PDF tools instead of guessing from text alone.",
        "Start with search_pdf_pages to find relevant pages.",
        "Use prepare_pdf_pages_for_model to send selected PDF pages as images for visual inspection.",
        "If the user explicitly names page numbers, you may send those pages directly.",
        "If the pages are auto-selected by the tool, wait for approval before sending them.",
        "Only use prepare_pdf_file_for_model when the user explicitly asks to inspect the entire PDF or whole document.",
      ].join("\n"),
    },
    presentation: {
      label: "Search PDF Pages",
      summaries: {
        onCall: "Locating the most relevant PDF pages",
        onSuccess: ({ content }) => {
          const pages =
            content &&
            typeof content === "object" &&
            Array.isArray((content as { pages?: unknown }).pages)
              ? (content as { pages: unknown[] }).pages
              : [];
          return pages.length > 0
            ? `Located ${pages.length} relevant PDF page${
                pages.length === 1 ? "" : "s"
              }`
            : "Could not find relevant PDF pages";
        },
      },
    },
    validate: (args) => {
      const parsed = parsePdfTargetArgs(args);
      if (!parsed.ok) return parsed;
      return requireQuestionOrPages(parsed.value);
    },
    execute: async (input, context) => {
      const result = await pdfPageService.searchPages({
        request: context.request,
        paperContext: input.paperContext,
        itemId: input.itemId,
        contextItemId: input.contextItemId,
        attachmentId: input.attachmentId,
        name: input.name,
        question: input.question || input.reason || context.request.userText,
        pages: input.pages,
        mode: input.mode,
        topK: input.topK,
      });
      return {
        target: {
          source: result.target.source,
          title: result.target.title,
          paperContext: result.target.paperContext,
          contextItemId: result.target.contextItemId,
          itemId: result.target.itemId,
          attachmentId: result.target.attachmentId,
        },
        explicitSelection: result.explicitSelection,
        pages: result.pages.map((page) => ({
          pageIndex: page.pageIndex,
          pageLabel: page.pageLabel,
          score: page.score,
          reason: page.reason,
          excerpt: page.excerpt,
        })),
      };
    },
  };
}
