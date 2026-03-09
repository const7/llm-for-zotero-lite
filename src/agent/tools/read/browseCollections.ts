import type { AgentToolDefinition } from "../../types";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import { fail, normalizePositiveInt, ok, validateObject } from "../shared";

type BrowseCollectionsInput = {
  libraryID?: number;
};

export function createBrowseCollectionsTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<BrowseCollectionsInput, unknown> {
  return {
    spec: {
      name: "browse_collections",
      description:
        "Browse the current Zotero library collection tree. Returns collection counts only and a separate unfiled-paper count.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          libraryID: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    presentation: {
      label: "Browse Collections",
      summaries: {
        onCall: "Browsing the library collection tree",
        onSuccess: ({ content }) => {
          const collections =
            content &&
            typeof content === "object" &&
            Array.isArray((content as { collections?: unknown }).collections)
              ? (content as { collections: unknown[] }).collections
              : [];
          return collections.length > 0
            ? `Loaded ${collections.length} top-level collection${
                collections.length === 1 ? "" : "s"
              }`
            : "No collections found in the active library";
        },
        onEmpty: "No collections found in the active library",
      },
    },
    validate: (args) => {
      if (args === undefined) {
        return ok<BrowseCollectionsInput>({});
      }
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      return ok<BrowseCollectionsInput>({
        libraryID: normalizePositiveInt(args.libraryID),
      });
    },
    execute: async (input, context) => {
      const libraryID = zoteroGateway.resolveLibraryID({
        request: context.request,
        item: context.item,
        libraryID: input.libraryID,
      });
      return zoteroGateway.browseCollections({
        libraryID,
      });
    },
  };
}
