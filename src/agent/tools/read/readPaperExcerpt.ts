import type { AgentToolDefinition } from "../../types";
import type { PdfService } from "../../services/pdfService";
import type { PaperContextRef } from "../../../modules/contextPanel/types";
import {
  fail,
  normalizePositiveInt,
  normalizeToolPaperContext,
  ok,
  validateObject,
} from "../shared";

type ReadPaperExcerptInput = {
  paperContext: PaperContextRef;
  chunkIndex: number;
};

export function createReadPaperExcerptTool(
  pdfService: PdfService,
): AgentToolDefinition<ReadPaperExcerptInput, unknown> {
  return {
    spec: {
      name: "read_paper_excerpt",
      description:
        "Read a specific chunk of PDF text for a given paper context and chunk index.",
      inputSchema: {
        type: "object",
        required: ["paperContext", "chunkIndex"],
        additionalProperties: false,
        properties: {
          paperContext: {
            type: "object",
            required: ["itemId", "contextItemId"],
            properties: {
              itemId: { type: "number" },
              contextItemId: { type: "number" },
              title: { type: "string" },
            },
          },
          chunkIndex: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      const paperContext = normalizeToolPaperContext(
        args.paperContext as Record<string, unknown>,
      );
      const chunkIndex = normalizePositiveInt(args.chunkIndex);
      if (!paperContext || chunkIndex === undefined) {
        return fail("paperContext and chunkIndex are required");
      }
      return ok({
        paperContext,
        chunkIndex,
      });
    },
    execute: async (input) => pdfService.getChunkExcerpt(input),
  };
}
