import type { AgentToolDefinition } from "../../types";
import {
  formatPageSelectionValue,
  parsePageSelectionText,
  type PdfPageService,
} from "../../services/pdfPageService";
import {
  buildPdfToolSchemaProperties,
  getUserEditablePageSelection,
  parsePdfTargetArgs,
  resolvePageSelectionFromResolution,
  type PdfTargetArgs,
} from "./pdfToolShared";
import { fail, ok } from "../shared";

function samePageSet(left: number[] | undefined, right: number[] | undefined): boolean {
  const normalizedLeft = Array.from(new Set(left || [])).sort((a, b) => a - b);
  const normalizedRight = Array.from(new Set(right || [])).sort((a, b) => a - b);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function createPreparePdfPagesForModelTool(
  pdfPageService: PdfPageService,
): AgentToolDefinition<PdfTargetArgs, unknown> {
  return {
    spec: {
      name: "prepare_pdf_pages_for_model",
      description:
        "Render specific PDF pages into model-visible page images so the model can inspect figures, equations, tables, or page layout. Prefer this over sending a whole PDF.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: buildPdfToolSchemaProperties(),
      },
      mutability: "read",
      requiresConfirmation: true,
    },
    validate: (args) => {
      const parsed = parsePdfTargetArgs(args);
      if (!parsed.ok) return parsed;
      if (!parsed.value.pages?.length) {
        return fail("pages is required");
      }
      return ok(parsed.value);
    },
    shouldRequireConfirmation: async (input, context) => {
      const explicit = parsePageSelectionText(context.request.userText);
      return !samePageSet(input.pages, explicit?.pageIndexes);
    },
    createPendingAction: async (input, context) => {
      const preview = await pdfPageService.preparePagesForModel({
        request: context.request,
        paperContext: input.paperContext,
        itemId: input.itemId,
        contextItemId: input.contextItemId,
        attachmentId: input.attachmentId,
        name: input.name,
        pages: input.pages || [],
        neighborPages: 0,
      });
      return {
        toolName: "prepare_pdf_pages_for_model",
        args: input,
        approvalKind: "pdf_send",
        title: `Review PDF pages for ${preview.target.title}`,
        description:
          "These pages will be sent to the model as images for visual inspection.",
        confirmLabel: "Apply",
        cancelLabel: "Cancel",
        pageSelectionLabel: "Pages to send",
        pageSelectionValue: getUserEditablePageSelection(input.pages),
        previewImages: preview.pages.map((page) => ({
          label: `Page ${page.pageLabel}`,
          storedPath: page.imagePath,
          mimeType: "image/png",
          title: `${preview.target.title} — page ${page.pageLabel}`,
        })),
        reviewItems: [
          {
            key: "pdf",
            label: "PDF",
            after: preview.target.title,
          },
          {
            key: "pages",
            label: "Pages",
            after: formatPageSelectionValue(input.pages || []),
          },
        ],
      };
    },
    applyConfirmation: (input, resolutionData) => {
      const selection = resolvePageSelectionFromResolution(
        resolutionData,
        input.pages,
      );
      if (!selection?.pageIndexes.length) {
        return fail("At least one page is required");
      }
      return ok({
        ...input,
        pages: selection.pageIndexes,
      });
    },
    execute: async (input, context) => {
      const prepared = await pdfPageService.preparePagesForModel({
        request: context.request,
        paperContext: input.paperContext,
        itemId: input.itemId,
        contextItemId: input.contextItemId,
        attachmentId: input.attachmentId,
        name: input.name,
        pages: input.pages || [],
        neighborPages: input.neighborPages,
      });
      return {
        content: {
          target: {
            source: prepared.target.source,
            title: prepared.target.title,
            paperContext: prepared.target.paperContext,
            contextItemId: prepared.target.contextItemId,
            itemId: prepared.target.itemId,
          },
          pageCount: prepared.pages.length,
          pages: prepared.pages.map((page) => ({
            pageIndex: page.pageIndex,
            pageLabel: page.pageLabel,
          })),
          transport: "page_images",
        },
        artifacts: prepared.artifacts,
      };
    },
  };
}
