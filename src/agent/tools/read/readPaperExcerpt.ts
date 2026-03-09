import type { AgentToolDefinition } from "../../types";
import type { PdfService } from "../../services/pdfService";
import type { PaperContextRef } from "../../../modules/contextPanel/types";
import {
  fail,
  normalizeToolPaperContext,
  ok,
  validateObject,
} from "../shared";

type ReadPaperExcerptInput = {
  paperContext: PaperContextRef;
  chunkIndex: number;
};

function normalizeChunkIndex(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

export function createReadPaperExcerptTool(
  pdfService: PdfService,
): AgentToolDefinition<ReadPaperExcerptInput, unknown> {
  return {
    spec: {
      name: "read_paper_excerpt",
      description:
        "Read a specific chunk of PDF text for a given paper context and chunk index. Use the exact zero-based chunkIndex returned by retrieve_paper_evidence.",
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
    presentation: {
      label: "Read Excerpt",
      summaries: {
        onCall: "Opening the exact passage behind that evidence",
        onSuccess: "Opened the strongest supporting passage",
      },
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      const paperContext = normalizeToolPaperContext(
        args.paperContext as Record<string, unknown>,
      );
      const chunkIndex = normalizeChunkIndex(args.chunkIndex);
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
