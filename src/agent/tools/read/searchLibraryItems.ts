import type { AgentToolDefinition } from "../../types";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  fail,
  normalizePositiveInt,
  ok,
  validateObject,
} from "../shared";

type SearchLibraryItemsInput = {
  query: string;
  limit?: number;
};

export function createSearchLibraryItemsTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<SearchLibraryItemsInput, unknown> {
  return {
    spec: {
      name: "search_library_items",
      description:
        "Search library papers by title, citation key, author, year, DOI, or attachment title.",
      inputSchema: {
        type: "object",
        required: ["query"],
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail<SearchLibraryItemsInput>("Expected an object");
      }
      if (typeof args.query !== "string" || !args.query.trim()) {
        return fail<SearchLibraryItemsInput>("query is required");
      }
      return ok<SearchLibraryItemsInput>({
        query: args.query.trim(),
        limit: normalizePositiveInt(args.limit),
      });
    },
    execute: async (input, context) => {
      const item =
        zoteroGateway.getItem(context.request.activeItemId) || context.item;
      const libraryID =
        item?.libraryID ||
        (Number.isFinite(context.request.libraryID)
          ? Math.floor(context.request.libraryID as number)
          : 0);
      if (!libraryID) {
        throw new Error("No active library available for search");
      }
      return {
        results: await zoteroGateway.searchLibraryItems({
          libraryID,
          query: input.query,
          excludeContextItemId:
            zoteroGateway.getActiveContextItem(item)?.id || null,
          limit: input.limit,
        }),
      };
    },
  };
}
