import type { PaperContextRef } from "../../../modules/contextPanel/types";
import type { AgentToolDefinition } from "../../types";
import type { PdfService } from "../../services/pdfService";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  fail,
  normalizePositiveInt,
  normalizeToolPaperContext,
  ok,
  validateObject,
} from "../shared";

type ReadPaperFrontMatterInput = {
  paperContext?: PaperContextRef;
  itemId?: number;
  maxChunks?: number;
  maxChars?: number;
};

function resolvePaperContext(
  input: ReadPaperFrontMatterInput,
  context: Parameters<
    AgentToolDefinition<ReadPaperFrontMatterInput, unknown>["execute"]
  >[1],
  pdfService: PdfService,
  zoteroGateway: ZoteroGateway,
): PaperContextRef | null {
  if (input.paperContext) return input.paperContext;
  const metadataItem = zoteroGateway.resolveMetadataItem({
    request: context.request,
    item: context.item,
    itemId: input.itemId,
  });
  return pdfService.getPaperContextForItem(metadataItem);
}

export function createReadPaperFrontMatterTool(
  pdfService: PdfService,
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<ReadPaperFrontMatterInput, unknown> {
  return {
    spec: {
      name: "read_paper_front_matter",
      description:
        "Read the opening PDF text for the current or specified paper so you can inspect title, authors, venue, DOI, and other front-matter metadata.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          paperContext: {
            type: "object",
            required: ["itemId", "contextItemId"],
            additionalProperties: true,
            properties: {
              itemId: { type: "number" },
              contextItemId: { type: "number" },
              title: { type: "string" },
            },
          },
          itemId: { type: "number" },
          maxChunks: { type: "number" },
          maxChars: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    presentation: {
      label: "Read Front Matter",
      summaries: {
        onCall: "Inspecting the paper front matter for metadata",
        onSuccess: "Checked the opening paper metadata text",
      },
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      const paperContext = validateObject<Record<string, unknown>>(args.paperContext)
        ? normalizeToolPaperContext(args.paperContext)
        : undefined;
      const itemId = normalizePositiveInt(args.itemId);
      const maxChunks = normalizePositiveInt(args.maxChunks);
      const maxChars = normalizePositiveInt(args.maxChars);
      return ok({
        paperContext: paperContext || undefined,
        itemId,
        maxChunks,
        maxChars,
      });
    },
    execute: async (input, context) => {
      const paperContext = resolvePaperContext(
        input,
        context,
        pdfService,
        zoteroGateway,
      );
      if (!paperContext) {
        throw new Error("No paper context available for front-matter reading");
      }
      return pdfService.getFrontMatterExcerpt({
        paperContext,
        maxChunks: input.maxChunks,
        maxChars: input.maxChars,
      });
    },
  };
}
