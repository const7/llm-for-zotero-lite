import type { AgentToolDefinition } from "../../types";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  fail,
  normalizePositiveInt,
  ok,
  validateObject,
} from "../shared";

type ListUnfiledPapersInput = {
  limit?: number;
  libraryID?: number;
};

export function createListUnfiledPapersTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<ListUnfiledPapersInput, unknown> {
  return {
    spec: {
      name: "list_unfiled_papers",
      description:
        "List papers in the active Zotero library that are not assigned to any collection.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
          libraryID: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    presentation: {
      label: "List Unfiled Papers",
      summaries: {
        onCall: "Listing unfiled papers in the active library",
        onSuccess: ({ content }) => {
          const papers =
            content &&
            typeof content === "object" &&
            Array.isArray((content as { papers?: unknown }).papers)
              ? (content as { papers: unknown[] }).papers
              : [];
          return papers.length > 0
            ? `Listed ${papers.length} unfiled paper${
                papers.length === 1 ? "" : "s"
              }`
            : "No unfiled papers found";
        },
        onEmpty: "No unfiled papers found",
      },
    },
    validate: (args) => {
      if (args === undefined) {
        return ok<ListUnfiledPapersInput>({});
      }
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      return ok<ListUnfiledPapersInput>({
        limit: normalizePositiveInt(args.limit),
        libraryID: normalizePositiveInt(args.libraryID),
      });
    },
    execute: async (input, context) => {
      const libraryID = zoteroGateway.resolveLibraryID({
        request: context.request,
        item: context.item,
        libraryID: input.libraryID,
      });
      return zoteroGateway.listUnfiledPaperTargets({
        libraryID,
        limit: input.limit,
      });
    },
  };
}
