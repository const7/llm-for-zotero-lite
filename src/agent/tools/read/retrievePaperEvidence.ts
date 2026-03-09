import type { AgentToolDefinition } from "../../types";
import type { RetrievalService } from "../../services/retrievalService";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  fail,
  normalizePositiveInt,
  normalizeToolPaperContext,
  ok,
  validateObject,
} from "../shared";

export function createRetrievePaperEvidenceTool(
  zoteroGateway: ZoteroGateway,
  retrievalService: RetrievalService,
): AgentToolDefinition<Record<string, unknown>, unknown> {
  return {
    spec: {
      name: "retrieve_paper_evidence",
      description:
        "Retrieve ranked paper evidence chunks for the current question from the active, selected, or specified papers.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          paperContext: {
            type: "object",
            properties: {
              itemId: { type: "number" },
              contextItemId: { type: "number" },
              title: { type: "string" },
            },
          },
          topK: { type: "number" },
          perPaperTopK: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (args === undefined) return ok<Record<string, unknown>>({});
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail<Record<string, unknown>>("Expected an object");
      }
      return ok<Record<string, unknown>>(args);
    },
    execute: async (input, context) => {
      const explicitPaper = validateObject<Record<string, unknown>>(input)
        ? normalizeToolPaperContext(input.paperContext as Record<string, unknown>)
        : null;
      const papers = explicitPaper
        ? [explicitPaper]
        : zoteroGateway.listPaperContexts(context.request);
      const question =
        validateObject<Record<string, unknown>>(input) &&
        typeof input.question === "string" &&
        input.question.trim()
          ? input.question.trim()
          : context.request.userText;
      const topK =
        validateObject<Record<string, unknown>>(input)
          ? normalizePositiveInt(input.topK)
          : undefined;
      const perPaperTopK =
        validateObject<Record<string, unknown>>(input)
          ? normalizePositiveInt(input.perPaperTopK)
          : undefined;
      return {
        evidence: await retrievalService.retrieveEvidence({
          papers,
          question,
          apiBase: context.request.apiBase,
          apiKey: context.request.apiKey,
          topK,
          perPaperTopK,
        }),
      };
    },
  };
}
