import type { AgentToolDefinition } from "../../types";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  fail,
  normalizePositiveInt,
  ok,
  validateObject,
} from "../shared";

type ListUntaggedPapersInput = {
  limit?: number;
  libraryID?: number;
};

export function createListUntaggedPapersTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<ListUntaggedPapersInput, unknown> {
  return {
    spec: {
      name: "list_untagged_papers",
      description:
        "List papers in the active Zotero library that currently have no manual tags.",
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
      label: "List Untagged Papers",
      summaries: {
        onCall: "Listing papers without tags in the active library",
        onSuccess: ({ content }) => {
          const papers =
            content &&
            typeof content === "object" &&
            Array.isArray((content as { papers?: unknown }).papers)
              ? (content as { papers: unknown[] }).papers
              : [];
          return papers.length > 0
            ? `Listed ${papers.length} untagged paper${
                papers.length === 1 ? "" : "s"
              }`
            : "No untagged papers found";
        },
        onEmpty: "No untagged papers found",
      },
    },
    validate: (args) => {
      if (args === undefined) {
        return ok<ListUntaggedPapersInput>({});
      }
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      return ok<ListUntaggedPapersInput>({
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
      return zoteroGateway.listUntaggedPaperTargets({
        libraryID,
        limit: input.limit,
      });
    },
  };
}
