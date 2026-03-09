import type { AgentToolDefinition } from "../../types";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  fail,
  normalizePositiveInt,
  ok,
  validateObject,
} from "../shared";

type ListCollectionPapersInput = {
  collectionId: number;
  limit?: number;
  libraryID?: number;
};

export function createListCollectionPapersTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<ListCollectionPapersInput, unknown> {
  return {
    spec: {
      name: "list_collection_papers",
      description:
        "List papers in an existing Zotero collection, including attachment refs and current tags.",
      inputSchema: {
        type: "object",
        required: ["collectionId"],
        additionalProperties: false,
        properties: {
          collectionId: { type: "number" },
          limit: { type: "number" },
          libraryID: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    presentation: {
      label: "List Collection Papers",
      summaries: {
        onCall: "Listing papers in the selected collection",
        onSuccess: ({ content }) => {
          const papers =
            content &&
            typeof content === "object" &&
            Array.isArray((content as { papers?: unknown }).papers)
              ? (content as { papers: unknown[] }).papers
              : [];
          return papers.length > 0
            ? `Listed ${papers.length} paper${papers.length === 1 ? "" : "s"}`
            : "No papers found in that collection";
        },
        onEmpty: "No papers found in that collection",
      },
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      const collectionId = normalizePositiveInt(args.collectionId);
      if (!collectionId) {
        return fail("collectionId is required");
      }
      return ok<ListCollectionPapersInput>({
        collectionId,
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
      return zoteroGateway.listCollectionPaperTargets({
        libraryID,
        collectionId: input.collectionId,
        limit: input.limit,
      });
    },
  };
}
