import {
  searchPaperCandidates,
  type PaperSearchGroupCandidate,
} from "../../modules/contextPanel/paperSearch";
import {
  createNoteFromAssistantText,
  createStandaloneNoteFromAssistantText,
} from "../../modules/contextPanel/notes";
import {
  getActiveContextAttachmentFromTabs,
  resolveContextSourceItem,
} from "../../modules/contextPanel/contextResolution";
import { resolvePaperContextRefFromAttachment } from "../../modules/contextPanel/paperAttribution";
import type { AgentRuntimeRequest } from "../types";
import type { PaperContextRef } from "../../modules/contextPanel/types";

function normalizePaperContexts(
  entries: PaperContextRef[] | undefined,
): PaperContextRef[] {
  if (!Array.isArray(entries)) return [];
  const out: PaperContextRef[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry) continue;
    const itemId = Number(entry.itemId);
    const contextItemId = Number(entry.contextItemId);
    if (!Number.isFinite(itemId) || !Number.isFinite(contextItemId)) continue;
    const normalized: PaperContextRef = {
      itemId: Math.floor(itemId),
      contextItemId: Math.floor(contextItemId),
      title: `${entry.title || `Paper ${Math.floor(itemId)}`}`.trim(),
      attachmentTitle: entry.attachmentTitle?.trim() || undefined,
      citationKey: entry.citationKey?.trim() || undefined,
      firstCreator: entry.firstCreator?.trim() || undefined,
      year: entry.year?.trim() || undefined,
    };
    const key = `${normalized.itemId}:${normalized.contextItemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export class ZoteroGateway {
  getItem(itemId: number | undefined): Zotero.Item | null {
    if (!Number.isFinite(itemId) || !itemId || itemId <= 0) return null;
    return Zotero.Items.get(Math.floor(itemId)) || null;
  }

  getActiveContextItem(item: Zotero.Item | null | undefined): Zotero.Item | null {
    if (item) {
      return resolveContextSourceItem(item).contextItem;
    }
    return getActiveContextAttachmentFromTabs();
  }

  getActivePaperContext(
    item: Zotero.Item | null | undefined,
  ): PaperContextRef | null {
    return resolvePaperContextRefFromAttachment(this.getActiveContextItem(item));
  }

  listPaperContexts(request: AgentRuntimeRequest): PaperContextRef[] {
    const out = [
      ...normalizePaperContexts(request.selectedPaperContexts),
      ...normalizePaperContexts(request.pinnedPaperContexts),
    ];
    const activeItem = this.getItem(request.activeItemId);
    const activeContext = this.getActivePaperContext(activeItem);
    if (activeContext) {
      const key = `${activeContext.itemId}:${activeContext.contextItemId}`;
      if (!out.some((entry) => `${entry.itemId}:${entry.contextItemId}` === key)) {
        out.unshift(activeContext);
      }
    }
    return out;
  }

  async searchLibraryItems(params: {
    libraryID: number;
    query: string;
    excludeContextItemId?: number | null;
    limit?: number;
  }): Promise<PaperSearchGroupCandidate[]> {
    return searchPaperCandidates(
      params.libraryID,
      params.query,
      params.excludeContextItemId,
      params.limit,
    );
  }

  async saveAnswerToNote(params: {
    item: Zotero.Item | null;
    libraryID?: number;
    content: string;
    modelName: string;
    target?: "item" | "standalone";
  }): Promise<"created" | "appended" | "standalone_created"> {
    if (params.target === "standalone") {
      const libraryID =
        Number.isFinite(params.libraryID) && (params.libraryID as number) > 0
          ? Math.floor(params.libraryID as number)
          : params.item?.libraryID || 0;
      await createStandaloneNoteFromAssistantText(
        libraryID,
        params.content,
        params.modelName,
      );
      return "standalone_created";
    }
    if (!params.item) {
      throw new Error("No Zotero item is active for item-note creation");
    }
    return createNoteFromAssistantText(
      params.item,
      params.content,
      params.modelName,
    );
  }
}
