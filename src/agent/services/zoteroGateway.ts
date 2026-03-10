import {
  browsePaperCollectionCandidates,
  invalidatePaperSearchCache,
  listLibraryPaperCandidates,
  searchPaperCandidates,
  type PaperBrowseCollectionCandidate,
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
import {
  isGlobalPortalItem,
  isPaperPortalItem,
  resolvePaperPortalBaseItem,
} from "../../modules/contextPanel/portalScope";

export const EDITABLE_ARTICLE_METADATA_FIELDS = [
  "title",
  "shortTitle",
  "abstractNote",
  "publicationTitle",
  "journalAbbreviation",
  "proceedingsTitle",
  "date",
  "volume",
  "issue",
  "pages",
  "DOI",
  "url",
  "language",
  "extra",
  "ISSN",
  "ISBN",
  "publisher",
  "place",
] as const;

export type EditableArticleMetadataField =
  (typeof EDITABLE_ARTICLE_METADATA_FIELDS)[number];

export type EditableArticleCreator = {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  fieldMode?: 0 | 1;
};

export type EditableArticleMetadataPatch = Partial<
  Record<EditableArticleMetadataField, string>
> & {
  creators?: EditableArticleCreator[];
};

export type EditableArticleMetadataSnapshot = {
  itemId: number;
  itemType: string;
  title: string;
  fields: Record<EditableArticleMetadataField, string>;
  creators: EditableArticleCreator[];
};

export type LibraryPaperTargetAttachment = {
  contextItemId: number;
  title: string;
};

export type LibraryPaperTarget = {
  itemId: number;
  title: string;
  firstCreator?: string;
  year?: string;
  attachments: LibraryPaperTargetAttachment[];
  tags: string[];
  collectionIds: number[];
};

export type CollectionBrowseNode = {
  collectionId: number;
  name: string;
  paperCount: number;
  descendantPaperCount: number;
  childCollections: CollectionBrowseNode[];
};

export type CollectionSummary = {
  collectionId: number;
  name: string;
  libraryID: number;
  path?: string;
};

export type BatchTagItemResult = {
  itemId: number;
  title: string;
  status: "updated" | "skipped" | "missing";
  addedTags: string[];
  skippedTags: string[];
  reason?: string;
};

export type BatchTagAssignment = {
  itemId: number;
  tags: string[];
};

export type BatchMoveItemResult = {
  itemId: number;
  title: string;
  status: "moved" | "skipped" | "missing";
  targetCollectionId?: number;
  targetCollectionName?: string;
  reason?: string;
};

export type BatchMoveAssignment = {
  itemId: number;
  targetCollectionId: number;
};

function normalizeMetadataValue(value: unknown): string {
  return `${value ?? ""}`.trim();
}

function normalizeText(value: unknown): string {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function resolveRegularItem(item: Zotero.Item | null | undefined): Zotero.Item | null {
  if (!item) return null;
  if (isGlobalPortalItem(item)) return null;
  if (isPaperPortalItem(item)) {
    return resolvePaperPortalBaseItem(item);
  }
  if (item.isAttachment() && item.parentID) {
    const parent = Zotero.Items.get(item.parentID) || null;
    return parent?.isRegularItem?.() ? parent : null;
  }
  return item?.isRegularItem?.() ? item : null;
}

function getItemTypeName(item: Zotero.Item): string {
  try {
    const name = (Zotero as unknown as { ItemTypes?: { getName?: (id: number) => string } })
      .ItemTypes?.getName?.(item.itemTypeID);
    return typeof name === "string" && name.trim() ? name.trim() : "";
  } catch (_error) {
    void _error;
    return "";
  }
}

function isFieldValidForItemType(
  item: Zotero.Item,
  fieldName: EditableArticleMetadataField,
): boolean {
  try {
    const itemFields = (Zotero as unknown as {
      ItemFields?: {
        getID?: (name: string) => number | false;
        isValidForType?: (fieldId: number, itemTypeId: number) => boolean;
      };
    }).ItemFields;
    const fieldId = itemFields?.getID?.(fieldName);
    if (fieldId === false || !fieldId) return false;
    if (typeof itemFields?.isValidForType !== "function") return true;
    return Boolean(itemFields.isValidForType(fieldId, item.itemTypeID));
  } catch (_error) {
    void _error;
    return true;
  }
}

function normalizeCreatorForSnapshot(
  creator: _ZoteroTypes.Item.CreatorJSON | _ZoteroTypes.Item.Creator,
): EditableArticleCreator | null {
  const creatorType =
    typeof (creator as { creatorType?: unknown }).creatorType === "string" &&
    (creator as { creatorType?: string }).creatorType?.trim()
      ? (creator as { creatorType: string }).creatorType.trim()
      : "author";
  const name =
    typeof (creator as { name?: unknown }).name === "string" &&
    (creator as { name?: string }).name?.trim()
      ? (creator as { name: string }).name.trim()
      : undefined;
  const firstName =
    typeof (creator as { firstName?: unknown }).firstName === "string" &&
    (creator as { firstName?: string }).firstName?.trim()
      ? (creator as { firstName: string }).firstName.trim()
      : undefined;
  const lastName =
    typeof (creator as { lastName?: unknown }).lastName === "string" &&
    (creator as { lastName?: string }).lastName?.trim()
      ? (creator as { lastName: string }).lastName.trim()
      : undefined;
  const fieldMode =
    Number((creator as { fieldMode?: unknown }).fieldMode) === 1 || name ? 1 : 0;
  if (!name && !firstName && !lastName) return null;
  return {
    creatorType,
    name,
    firstName,
    lastName,
    fieldMode,
  };
}

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

function getCollectionIDs(item: Zotero.Item | null | undefined): number[] {
  if (!item) return [];
  try {
    return item
      .getCollections()
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => Math.floor(id));
  } catch (_error) {
    void _error;
    return [];
  }
}

function resolveLibraryDisplayName(libraryID: number): string {
  try {
    const libraries = (Zotero as unknown as {
      Libraries?: {
        getName?: (targetLibraryID: number) => unknown;
        get?: (targetLibraryID: number) => { name?: unknown } | null | undefined;
      };
    }).Libraries;
    const directName = normalizeText(libraries?.getName?.(libraryID));
    if (directName) return directName;
    const library = libraries?.get?.(libraryID);
    const objectName = normalizeText(library?.name);
    if (objectName) return objectName;
  } catch (_error) {
    void _error;
  }
  return "My Library";
}

function getPdfChildAttachments(item: Zotero.Item): Zotero.Item[] {
  const out: Zotero.Item[] = [];
  if (!item?.isRegularItem?.()) return out;
  for (const attachmentId of item.getAttachments()) {
    const attachment = Zotero.Items.get(attachmentId) || null;
    if (
      attachment &&
      attachment.isAttachment?.() &&
      attachment.attachmentContentType === "application/pdf"
    ) {
      out.push(attachment);
    }
  }
  return out;
}

function resolveAttachmentTitle(
  attachment: Zotero.Item,
  index: number,
  total: number,
): string {
  const title = normalizeText(attachment.getField?.("title"));
  if (title) return title;
  const filename = normalizeText(
    (attachment as unknown as { attachmentFilename?: string }).attachmentFilename,
  );
  if (filename) return filename;
  return total > 1 ? `PDF ${index + 1}` : "PDF";
}

function getItemTags(item: Zotero.Item | null | undefined): string[] {
  if (!item) return [];
  try {
    const out = (item.getTags?.() || [])
      .map((entry) => normalizeText(entry?.tag))
      .filter(Boolean);
    return Array.from(new Set(out)).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  } catch (_error) {
    void _error;
    return [];
  }
}

function buildPaperTargetFromItem(item: Zotero.Item): LibraryPaperTarget | null {
  const target = resolveRegularItem(item);
  if (!target) return null;
  const attachments = getPdfChildAttachments(target).map((attachment, index, list) => ({
    contextItemId: attachment.id,
    title: resolveAttachmentTitle(attachment, index, list.length),
  }));
  if (!attachments.length) return null;
  return {
    itemId: target.id,
    title:
      normalizeText(target.getField?.("title")) ||
      normalizeText(target.getDisplayTitle?.()) ||
      `Item ${target.id}`,
    firstCreator:
      normalizeText(target.firstCreator) ||
      normalizeText(target.getField?.("firstCreator")) ||
      undefined,
    year:
      normalizeText(target.getField?.("date")).match(/\b(19|20)\d{2}\b/)?.[0] ||
      undefined,
    attachments,
    tags: getItemTags(target),
    collectionIds: getCollectionIDs(target),
  };
}

function summarizeCollectionNode(
  candidate: PaperBrowseCollectionCandidate,
): CollectionBrowseNode {
  const childCollections = candidate.childCollections.map((entry) =>
    summarizeCollectionNode(entry),
  );
  const paperCount = candidate.papers.length;
  const descendantPaperCount =
    paperCount +
    childCollections.reduce((sum, entry) => sum + entry.descendantPaperCount, 0);
  return {
    collectionId: candidate.collectionId,
    name: normalizeText(candidate.name) || `Collection ${candidate.collectionId}`,
    paperCount,
    descendantPaperCount,
    childCollections,
  };
}

function listLibraryCollections(libraryID: number): Zotero.Collection[] {
  if (!Number.isFinite(libraryID) || libraryID <= 0) return [];
  try {
    return Zotero.Collections.getByLibrary(Math.floor(libraryID), true) || [];
  } catch (_error) {
    void _error;
    return [];
  }
}

function buildCollectionPathMap(
  collections: Zotero.Collection[],
): Map<number, string> {
  const byId = new Map<number, Zotero.Collection>();
  const pathById = new Map<number, string>();
  for (const collection of collections) {
    byId.set(collection.id, collection);
  }
  const resolvePath = (collectionId: number): string => {
    const cached = pathById.get(collectionId);
    if (cached) return cached;
    const collection = byId.get(collectionId);
    if (!collection) return "";
    const name = normalizeText(collection.name) || `Collection ${collection.id}`;
    const parentId = Number(collection.parentID);
    if (!Number.isFinite(parentId) || parentId <= 0 || !byId.has(parentId)) {
      pathById.set(collectionId, name);
      return name;
    }
    const path = `${resolvePath(Math.floor(parentId))} / ${name}`;
    pathById.set(collectionId, path);
    return path;
  };
  for (const collection of collections) {
    resolvePath(collection.id);
  }
  return pathById;
}

export class ZoteroGateway {
  getItem(itemId: number | undefined): Zotero.Item | null {
    if (!Number.isFinite(itemId) || !itemId || itemId <= 0) return null;
    return Zotero.Items.get(Math.floor(itemId)) || null;
  }

  getCollection(collectionId: number | undefined): Zotero.Collection | null {
    if (!Number.isFinite(collectionId) || !collectionId || collectionId <= 0) {
      return null;
    }
    return Zotero.Collections.get(Math.floor(collectionId)) || null;
  }

  resolveLibraryID(params: {
    request?: AgentRuntimeRequest;
    item?: Zotero.Item | null;
    libraryID?: number;
  }): number {
    const explicitLibraryID = Number(params.libraryID);
    if (Number.isFinite(explicitLibraryID) && explicitLibraryID > 0) {
      return Math.floor(explicitLibraryID);
    }
    const itemLibraryID = Number(params.item?.libraryID);
    if (Number.isFinite(itemLibraryID) && itemLibraryID > 0) {
      return Math.floor(itemLibraryID);
    }
    const requestLibraryID = Number(params.request?.libraryID);
    if (Number.isFinite(requestLibraryID) && requestLibraryID > 0) {
      return Math.floor(requestLibraryID);
    }
    const activeItemLibraryID = Number(
      this.getItem(params.request?.activeItemId)?.libraryID,
    );
    if (Number.isFinite(activeItemLibraryID) && activeItemLibraryID > 0) {
      return Math.floor(activeItemLibraryID);
    }
    return 0;
  }

  getCollectionSummary(collectionId: number | undefined): CollectionSummary | null {
    const collection = this.getCollection(collectionId);
    if (!collection) return null;
    const pathMap = buildCollectionPathMap(
      listLibraryCollections(Number(collection.libraryID) || 0),
    );
    return {
      collectionId: collection.id,
      name: normalizeText(collection.name) || `Collection ${collection.id}`,
      libraryID: Number(collection.libraryID) || 0,
      path:
        pathMap.get(collection.id) ||
        normalizeText(collection.name) ||
        `Collection ${collection.id}`,
    };
  }

  listCollectionSummaries(libraryID: number): CollectionSummary[] {
    const normalizedLibraryID = Number.isFinite(libraryID)
      ? Math.floor(libraryID)
      : 0;
    if (!normalizedLibraryID) return [];
    const collections = listLibraryCollections(normalizedLibraryID);
    const pathMap = buildCollectionPathMap(collections);
    return collections
      .map((collection) => ({
        collectionId: collection.id,
        name: normalizeText(collection.name) || `Collection ${collection.id}`,
        libraryID: Number(collection.libraryID) || normalizedLibraryID,
        path:
          pathMap.get(collection.id) ||
          normalizeText(collection.name) ||
          `Collection ${collection.id}`,
      }))
      .sort((left, right) =>
        (left.path || left.name).localeCompare(right.path || right.name, undefined, {
          sensitivity: "base",
        }),
      );
  }

  getPaperTargetsByItemIds(itemIds: number[]): LibraryPaperTarget[] {
    const out: LibraryPaperTarget[] = [];
    const seen = new Set<number>();
    for (const rawItemId of itemIds) {
      const item = this.resolveBibliographicItem(this.getItem(rawItemId));
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      const target = buildPaperTargetFromItem(item);
      if (target) {
        out.push(target);
      }
    }
    return out;
  }

  resolveBibliographicItem(
    item: Zotero.Item | null | undefined,
  ): Zotero.Item | null {
    return resolveRegularItem(item);
  }

  resolveMetadataItem(params: {
    request?: AgentRuntimeRequest;
    item?: Zotero.Item | null;
    itemId?: number;
    paperContext?: PaperContextRef | null;
  }): Zotero.Item | null {
    const byItemId = resolveRegularItem(this.getItem(params.itemId));
    if (byItemId) return byItemId;
    const byPaperContext = resolveRegularItem(this.getItem(params.paperContext?.itemId));
    if (byPaperContext) return byPaperContext;
    const byActiveItem = resolveRegularItem(
      this.getItem(params.request?.activeItemId),
    );
    if (byActiveItem) return byActiveItem;
    return resolveRegularItem(params.item || null);
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

  getEditableArticleMetadata(
    item: Zotero.Item | null | undefined,
  ): EditableArticleMetadataSnapshot | null {
    const target = resolveRegularItem(item);
    if (!target) return null;
    const fields = Object.fromEntries(
      EDITABLE_ARTICLE_METADATA_FIELDS.map((fieldName) => {
        let value = "";
        try {
          value = normalizeMetadataValue(target.getField(fieldName));
        } catch (_error) {
          void _error;
        }
        return [fieldName, value];
      }),
    ) as Record<EditableArticleMetadataField, string>;
    let creators: EditableArticleCreator[] = [];
    try {
      creators = (target.getCreatorsJSON?.() || [])
        .map((creator) => normalizeCreatorForSnapshot(creator))
        .filter((creator): creator is EditableArticleCreator => Boolean(creator));
    } catch (_error) {
      void _error;
    }
    return {
      itemId: target.id,
      itemType: getItemTypeName(target),
      title:
        normalizeMetadataValue(target.getDisplayTitle?.()) ||
        fields.title ||
        `Item ${target.id}`,
      fields,
      creators,
    };
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

  async browseCollections(params: {
    libraryID: number;
  }): Promise<{
    libraryID: number;
    libraryName: string;
    collections: CollectionBrowseNode[];
    unfiled: {
      name: string;
      paperCount: number;
    };
  }> {
    const libraryID = Number.isFinite(params.libraryID)
      ? Math.floor(params.libraryID)
      : 0;
    if (!libraryID) {
      throw new Error("No active library available for browsing collections");
    }
    const candidates = await browsePaperCollectionCandidates(libraryID);
    const collections = candidates
      .filter((entry) => entry.collectionId > 0)
      .map((entry) => summarizeCollectionNode(entry));
    const unfiledNode =
      candidates.find((entry) => entry.collectionId === 0) || null;
    return {
      libraryID,
      libraryName: resolveLibraryDisplayName(libraryID),
      collections,
      unfiled: {
        name: "Unfiled",
        paperCount: unfiledNode?.papers.length || 0,
      },
    };
  }

  async listCollectionPaperTargets(params: {
    libraryID: number;
    collectionId: number;
    limit?: number;
  }): Promise<{
    collection: CollectionSummary;
    papers: LibraryPaperTarget[];
    totalCount: number;
  }> {
    const collection = this.getCollectionSummary(params.collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    const libraryID = Number.isFinite(params.libraryID)
      ? Math.floor(params.libraryID)
      : 0;
    if (!libraryID) {
      throw new Error("No active library available for listing collection papers");
    }
    if (collection.libraryID && collection.libraryID !== libraryID) {
      throw new Error("Collection does not belong to the active library");
    }
    const candidates = await listLibraryPaperCandidates(libraryID);
    const papers: LibraryPaperTarget[] = [];
    for (const candidate of candidates) {
      const item = this.resolveBibliographicItem(this.getItem(candidate.itemId));
      if (!item?.inCollection?.(collection.collectionId)) continue;
      const target = buildPaperTargetFromItem(item);
      if (target) {
        papers.push(target);
      }
    }
    const normalizedLimit = Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit as number))
      : undefined;
    return {
      collection,
      papers:
        normalizedLimit && papers.length > normalizedLimit
          ? papers.slice(0, normalizedLimit)
          : papers,
      totalCount: papers.length,
    };
  }

  async listUnfiledPaperTargets(params: {
    libraryID: number;
    limit?: number;
  }): Promise<{
    papers: LibraryPaperTarget[];
    totalCount: number;
  }> {
    const libraryID = Number.isFinite(params.libraryID)
      ? Math.floor(params.libraryID)
      : 0;
    if (!libraryID) {
      throw new Error("No active library available for listing unfiled papers");
    }
    const candidates = await listLibraryPaperCandidates(libraryID);
    const papers: LibraryPaperTarget[] = [];
    for (const candidate of candidates) {
      const item = this.resolveBibliographicItem(this.getItem(candidate.itemId));
      if (!item) continue;
      const target = buildPaperTargetFromItem(item);
      if (target && target.collectionIds.length === 0) {
        papers.push(target);
      }
    }
    const normalizedLimit = Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit as number))
      : undefined;
    return {
      papers:
        normalizedLimit && papers.length > normalizedLimit
          ? papers.slice(0, normalizedLimit)
          : papers,
      totalCount: papers.length,
    };
  }

  async listUntaggedPaperTargets(params: {
    libraryID: number;
    limit?: number;
  }): Promise<{
    papers: LibraryPaperTarget[];
    totalCount: number;
  }> {
    const libraryID = Number.isFinite(params.libraryID)
      ? Math.floor(params.libraryID)
      : 0;
    if (!libraryID) {
      throw new Error("No active library available for listing untagged papers");
    }
    const candidates = await listLibraryPaperCandidates(libraryID);
    const papers: LibraryPaperTarget[] = [];
    for (const candidate of candidates) {
      const item = this.resolveBibliographicItem(this.getItem(candidate.itemId));
      if (!item) continue;
      const target = buildPaperTargetFromItem(item);
      if (target && target.tags.length === 0) {
        papers.push(target);
      }
    }
    const normalizedLimit = Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit as number))
      : undefined;
    return {
      papers:
        normalizedLimit && papers.length > normalizedLimit
          ? papers.slice(0, normalizedLimit)
          : papers,
      totalCount: papers.length,
    };
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

  async applyTagAssignments(params: {
    assignments: BatchTagAssignment[];
  }): Promise<{
    selectedCount: number;
    updatedCount: number;
    skippedCount: number;
    items: BatchTagItemResult[];
  }> {
    const normalizedAssignments: BatchTagAssignment[] = [];
    const seen = new Set<number>();
    for (const entry of params.assignments) {
      const itemId = Number.isFinite(entry.itemId) ? Math.floor(entry.itemId) : 0;
      const tags = Array.from(
        new Set(
          (Array.isArray(entry.tags) ? entry.tags : [])
            .map((tag) => normalizeText(tag))
            .filter(Boolean),
        ),
      );
      if (!itemId || !tags.length || seen.has(itemId)) continue;
      seen.add(itemId);
      normalizedAssignments.push({
        itemId,
        tags,
      });
    }
    if (!normalizedAssignments.length) {
      throw new Error("No valid tag assignments were provided");
    }
    const results: BatchTagItemResult[] = [];
    let updatedCount = 0;
    for (const assignment of normalizedAssignments) {
      const item = this.resolveBibliographicItem(this.getItem(assignment.itemId));
      if (!item) {
        results.push({
          itemId: assignment.itemId,
          title: `Item ${assignment.itemId}`,
          status: "missing",
          addedTags: [],
          skippedTags: assignment.tags,
          reason: "Item not found",
        });
        continue;
      }
      const target = buildPaperTargetFromItem(item);
      const title =
        target?.title ||
        normalizeText(item.getDisplayTitle?.()) ||
        `Item ${item.id}`;
      const addedTags: string[] = [];
      const skippedTags: string[] = [];
      for (const tag of assignment.tags) {
        if (!tag) continue;
        if (item.hasTag?.(tag)) {
          skippedTags.push(tag);
          continue;
        }
        item.addTag?.(tag, 0);
        addedTags.push(tag);
      }
      if (addedTags.length) {
        await item.saveTx();
        updatedCount += 1;
      }
      results.push({
        itemId: item.id,
        title,
        status: addedTags.length ? "updated" : "skipped",
        addedTags,
        skippedTags,
        reason: addedTags.length ? undefined : "All tags already existed",
      });
    }
    return {
      selectedCount: normalizedAssignments.length,
      updatedCount,
      skippedCount: results.length - updatedCount,
      items: results,
    };
  }

  async applyTagsToItems(params: {
    itemIds: number[];
    tags: string[];
  }): Promise<{
    selectedCount: number;
    updatedCount: number;
    skippedCount: number;
    items: BatchTagItemResult[];
  }> {
    return this.applyTagAssignments({
      assignments: params.itemIds.map((itemId) => ({
        itemId,
        tags: params.tags,
      })),
    });
  }

  async moveUnfiledItemsToCollections(params: {
    assignments: BatchMoveAssignment[];
  }): Promise<{
    selectedCount: number;
    movedCount: number;
    skippedCount: number;
    collections: CollectionSummary[];
    items: BatchMoveItemResult[];
  }> {
    const normalizedAssignments: BatchMoveAssignment[] = [];
    const seen = new Set<number>();
    for (const entry of params.assignments) {
      const itemId = Number.isFinite(entry.itemId) ? Math.floor(entry.itemId) : 0;
      const targetCollectionId = Number.isFinite(entry.targetCollectionId)
        ? Math.floor(entry.targetCollectionId)
        : 0;
      if (!itemId || !targetCollectionId || seen.has(itemId)) continue;
      seen.add(itemId);
      normalizedAssignments.push({
        itemId,
        targetCollectionId,
      });
    }
    if (!normalizedAssignments.length) {
      throw new Error("No valid collection assignments were provided");
    }
    const collectionMap = new Map<number, CollectionSummary>();
    for (const assignment of normalizedAssignments) {
      if (collectionMap.has(assignment.targetCollectionId)) continue;
      const collection = this.getCollectionSummary(assignment.targetCollectionId);
      if (!collection) {
        throw new Error("Collection not found");
      }
      collectionMap.set(assignment.targetCollectionId, collection);
    }
    const results: BatchMoveItemResult[] = [];
    let movedCount = 0;
    for (const assignment of normalizedAssignments) {
      const collection = collectionMap.get(assignment.targetCollectionId);
      if (!collection) {
        results.push({
          itemId: assignment.itemId,
          title: `Item ${assignment.itemId}`,
          status: "missing",
          targetCollectionId: assignment.targetCollectionId,
          reason: "Collection not found",
        });
        continue;
      }
      const item = this.resolveBibliographicItem(this.getItem(assignment.itemId));
      if (!item) {
        results.push({
          itemId: assignment.itemId,
          title: `Item ${assignment.itemId}`,
          status: "missing",
          targetCollectionId: collection.collectionId,
          targetCollectionName: collection.path || collection.name,
          reason: "Item not found",
        });
        continue;
      }
      const target = buildPaperTargetFromItem(item);
      const title = target?.title || normalizeText(item.getDisplayTitle?.()) || `Item ${item.id}`;
      if (getCollectionIDs(item).length > 0) {
        results.push({
          itemId: item.id,
          title,
          status: "skipped",
          targetCollectionId: collection.collectionId,
          targetCollectionName: collection.path || collection.name,
          reason: "Paper is no longer unfiled",
        });
        continue;
      }
      item.addToCollection(collection.collectionId);
      await item.saveTx();
      movedCount += 1;
      results.push({
        itemId: item.id,
        title,
        status: "moved",
        targetCollectionId: collection.collectionId,
        targetCollectionName: collection.path || collection.name,
      });
    }
    if (movedCount > 0) {
      const touchedLibraryIDs = new Set<number>();
      for (const collection of collectionMap.values()) {
        if (collection.libraryID > 0) {
          touchedLibraryIDs.add(collection.libraryID);
        }
      }
      for (const libraryID of touchedLibraryIDs) {
        invalidatePaperSearchCache(libraryID);
      }
    }
    return {
      selectedCount: normalizedAssignments.length,
      movedCount,
      skippedCount: results.length - movedCount,
      collections: Array.from(collectionMap.values()),
      items: results,
    };
  }

  async moveUnfiledItemsToCollection(params: {
    itemIds: number[];
    targetCollectionId: number;
  }): Promise<{
    selectedCount: number;
    movedCount: number;
    skippedCount: number;
    collection: CollectionSummary;
    items: BatchMoveItemResult[];
  }> {
    const collection = this.getCollectionSummary(params.targetCollectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    const result = await this.moveUnfiledItemsToCollections({
      assignments: params.itemIds.map((itemId) => ({
        itemId,
        targetCollectionId: params.targetCollectionId,
      })),
    });
    return {
      selectedCount: result.selectedCount,
      movedCount: result.movedCount,
      skippedCount: result.skippedCount,
      collection,
      items: result.items,
    };
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

  async updateArticleMetadata(params: {
    item: Zotero.Item | null;
    metadata: EditableArticleMetadataPatch;
  }): Promise<{
    status: "updated";
    itemId: number;
    title: string;
    changedFields: string[];
  }> {
    const item = resolveRegularItem(params.item);
    if (!item) {
      throw new Error("No Zotero bibliographic item is active for metadata editing");
    }

    const fieldNames = EDITABLE_ARTICLE_METADATA_FIELDS.filter((fieldName) =>
      Object.prototype.hasOwnProperty.call(params.metadata, fieldName),
    );
    const unsupportedFields = fieldNames.filter(
      (fieldName) => !isFieldValidForItemType(item, fieldName),
    );
    if (unsupportedFields.length) {
      const itemTypeName = getItemTypeName(item) || "this item type";
      throw new Error(
        `Unsupported metadata fields for ${itemTypeName}: ${unsupportedFields.join(", ")}`,
      );
    }

    for (const fieldName of fieldNames) {
      item.setField(fieldName, params.metadata[fieldName] || "");
    }

    if (Array.isArray(params.metadata.creators)) {
      const creatorTypes = (Zotero as unknown as {
        CreatorTypes?: { itemTypeHasCreators?: (itemTypeId: number) => boolean };
      }).CreatorTypes;
      const supportsCreators =
        typeof creatorTypes?.itemTypeHasCreators === "function"
          ? creatorTypes.itemTypeHasCreators(item.itemTypeID)
          : true;
      if (!supportsCreators) {
        const itemTypeName = getItemTypeName(item) || "this item type";
        throw new Error(`Creators are not supported for ${itemTypeName}`);
      }
      item.setCreators(
        params.metadata.creators as Array<
          _ZoteroTypes.Item.CreatorJSON | _ZoteroTypes.Item.Creator
        >,
        { strict: true },
      );
    }

    await item.saveTx();
    const changedFields = [
      ...fieldNames,
      ...(Array.isArray(params.metadata.creators) ? ["creators"] : []),
    ];
    const snapshot = this.getEditableArticleMetadata(item);
    return {
      status: "updated",
      itemId: item.id,
      title: snapshot?.title || `Item ${item.id}`,
      changedFields,
    };
  }
}
