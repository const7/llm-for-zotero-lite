import type { AgentAction, ActionExecutionContext, ActionResult } from "./types";
import type { EditableArticleMetadataPatch } from "../services/zoteroGateway";
import { callTool } from "./executor";
import {
  getMetadataField,
  hasMetadataCreators,
} from "./metadataSnapshot";

type SyncMetadataInput = {
  scope?: "all" | "collection";
  collectionId?: number;
};

type SyncMetadataOutput = {
  scanned: number;
  withDoi: number;
  updated: number;
  skipped: number;
  errors: number;
};

/**
 * Fetches canonical metadata from CrossRef/Semantic Scholar for each library item
 * that has a DOI, then fills in missing fields (abstract, year, venue, authors)
 * and presents a before/after diff for user review before applying changes.
 */
export const syncMetadataAction: AgentAction<SyncMetadataInput, SyncMetadataOutput> = {
  name: "sync_metadata",
  description:
    "Fetch canonical metadata from CrossRef and Semantic Scholar for library items that have a DOI. " +
    "Shows a before/after diff and applies missing fields (abstract, year, venue) after user approval.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scope: {
        type: "string",
        enum: ["all", "collection"],
        description: "Which items to sync. Default: 'all'.",
      },
      collectionId: {
        type: "number",
        description: "Required when scope is 'collection'.",
      },
    },
  },

  async execute(
    input: SyncMetadataInput,
    ctx: ActionExecutionContext,
  ): Promise<ActionResult<SyncMetadataOutput>> {
    const STEPS = 3;
    let step = 0;

    // Step 1: query items that have a DOI
    ctx.onProgress({
      type: "step_start",
      step: "Querying items with DOI",
      index: ++step,
      total: STEPS,
    });

    const queryArgs: Record<string, unknown> = {
      entity: "items",
      mode: "list",
      include: ["metadata"],
    };
    if (input.scope === "collection" && input.collectionId) {
      queryArgs.filters = { collectionId: input.collectionId };
    }

    const queryResult = await callTool("query_library", queryArgs, ctx, "Querying library items");
    if (!queryResult.ok) {
      return { ok: false, error: `Failed to query library: ${JSON.stringify(queryResult.content)}` };
    }

    const content = queryResult.content as Record<string, unknown>;
    const allItems = Array.isArray(content.results) ? content.results : [];

    type ItemWithDoi = { itemId: number; doi: string; currentMeta: unknown };
    const itemsWithDoi: ItemWithDoi[] = [];
    for (const item of allItems) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const itemId = typeof record.itemId === "number" ? record.itemId : null;
      if (!itemId) continue;
      const meta = record.metadata;
      const doi = getMetadataField(meta, "DOI")?.replace(/^https?:\/\/doi\.org\//i, "") || null;
      if (doi) {
        itemsWithDoi.push({ itemId, doi, currentMeta: meta });
      }
    }

    ctx.onProgress({
      type: "step_done",
      step: "Querying items with DOI",
      summary: `${itemsWithDoi.length} of ${allItems.length} items have a DOI`,
    });

    if (!itemsWithDoi.length) {
      return {
        ok: true,
        output: { scanned: allItems.length, withDoi: 0, updated: 0, skipped: 0, errors: 0 },
      };
    }

    // Step 2: fetch canonical metadata for each DOI
    ctx.onProgress({
      type: "step_start",
      step: "Fetching canonical metadata",
      index: ++step,
      total: STEPS,
    });

    type UpdateCandidate = {
      itemId: number;
      doi: string;
      patch: EditableArticleMetadataPatch;
      currentMeta: unknown;
      externalTitle: string;
    };
    const updateCandidates: UpdateCandidate[] = [];
    let errorCount = 0;

    for (const { itemId, doi, currentMeta } of itemsWithDoi) {
      ctx.onProgress({
        type: "status",
        message: `Fetching metadata for DOI: ${doi}`,
      });

      const metaResult = await callTool(
        "search_literature_online",
        { mode: "metadata", doi, libraryID: ctx.libraryID },
        ctx,
        `Fetching metadata for ${doi}`,
      );

      if (!metaResult.ok) {
        errorCount++;
        continue;
      }

      const metaContent = metaResult.content as Record<string, unknown>;
      const results = Array.isArray(metaContent.results) ? metaContent.results : [];
      const externalMeta = results[0] as Record<string, unknown> | undefined;
      if (!externalMeta) continue;

      // Build patch: only fill in fields that are currently empty in Zotero
      const patch: EditableArticleMetadataPatch = {};

      if (
        !getMetadataField(currentMeta, "abstractNote") &&
        typeof externalMeta.abstract === "string" &&
        externalMeta.abstract.trim()
      ) {
        patch.abstractNote = externalMeta.abstract.trim();
      }
      if (!getMetadataField(currentMeta, "date") && (externalMeta.year || externalMeta.publicationDate)) {
        const yearStr = String(externalMeta.year || externalMeta.publicationDate || "").trim();
        if (yearStr) patch.date = yearStr;
      }
      if (
        !getMetadataField(currentMeta, "publicationTitle") &&
        typeof externalMeta.venue === "string" &&
        externalMeta.venue.trim()
      ) {
        patch.publicationTitle = externalMeta.venue.trim();
      }
      if (!hasMetadataCreators(currentMeta) && Array.isArray(externalMeta.authors)) {
        const creators = externalMeta.authors
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((name) => ({
            creatorType: "author",
            name: name.trim(),
          }));
        if (creators.length) {
          patch.creators = creators;
        }
      }

      if (Object.keys(patch).length > 0) {
        updateCandidates.push({
          itemId,
          doi,
          patch,
          currentMeta,
          externalTitle: typeof externalMeta.title === "string" ? externalMeta.title : String(itemId),
        });
      }
    }

    ctx.onProgress({
      type: "step_done",
      step: "Fetching canonical metadata",
      summary: `${updateCandidates.length} items have updatable fields`,
    });

    if (!updateCandidates.length) {
      return {
        ok: true,
        output: {
          scanned: allItems.length,
          withDoi: itemsWithDoi.length,
          updated: 0,
          skipped: itemsWithDoi.length,
          errors: errorCount,
        },
      };
    }

    // Step 3: apply updates via mutate_library (with HITL diff review)
    ctx.onProgress({
      type: "step_start",
      step: "Applying metadata updates",
      index: ++step,
      total: STEPS,
    });

    const operations = updateCandidates.map(({ itemId, patch }) => ({
      type: "update_metadata",
      itemId,
      metadata: patch,
    }));

    const mutateResult = await callTool(
      "mutate_library",
      { operations },
      ctx,
      "Updating metadata",
    );

    const mutateContent = mutateResult.content as Record<string, unknown>;
    const succeeded = mutateResult.ok
      ? (Array.isArray(mutateContent.results) ? mutateContent.results.length : updateCandidates.length)
      : 0;
    const denied = mutateResult.ok ? 0 : updateCandidates.length;

    ctx.onProgress({
      type: "step_done",
      step: "Applying metadata updates",
      summary: mutateResult.ok
        ? `Updated ${succeeded} item${succeeded === 1 ? "" : "s"}`
        : `Update was denied or failed`,
    });

    return {
      ok: true,
      output: {
        scanned: allItems.length,
        withDoi: itemsWithDoi.length,
        updated: succeeded,
        skipped: itemsWithDoi.length - updateCandidates.length + denied,
        errors: errorCount,
      },
    };
  },
};
