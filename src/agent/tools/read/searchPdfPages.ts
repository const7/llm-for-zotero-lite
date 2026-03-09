import type { AgentToolDefinition } from "../../types";
import type { PdfPageService } from "../../services/pdfPageService";
import {
  buildPdfToolSchemaProperties,
  parsePdfTargetArgs,
  requireQuestionOrPages,
  type PdfTargetArgs,
} from "./pdfToolShared";

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
