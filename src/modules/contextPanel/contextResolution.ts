import {
  normalizeSelectedText,
  isLikelyCorruptedSelectedText,
  setStatus,
} from "./textUtils";
import {
  normalizePaperContextRefs,
  normalizePositiveInt,
  normalizeSelectedTextSource,
} from "./normalizers";
import { MAX_SELECTED_TEXT_CONTEXTS } from "./constants";
import {
  selectedTextCache,
  selectedTextPreviewExpandedCache,
  pinnedSelectedTextKeys,
} from "./state";
import type {
  ZoteroTabsState,
  ResolvedContextSource,
  SelectedTextContext,
  SelectedTextSource,
  PaperContextRef,
} from "./types";
import {
  buildPinnedSelectedTextKey,
  isPinnedSelectedText,
  prunePinnedSelectedTextKeys,
} from "./setupHandlers/controllers/pinnedContextController";

type SelectedTextPageLocation = {
  contextItemId?: number;
  pageIndex?: number;
  pageLabel?: string;
};

/**
 * Last known selected tab ID.  Updated every time we successfully read
 * selectedID from Zotero.Tabs (which fails during nested Tabs.select
 * transitions).  Used by restoreNonReaderTab as a fallback.
 */
let _lastKnownSelectedTabId: string | number | null = null;

export function getLastKnownSelectedTabId(): string | number | null {
  return _lastKnownSelectedTabId;
}

export function getActiveReaderForSelectedTab(): any | null {
  const tabs = getZoteroTabsState();
  const selectedTabId = tabs?.selectedID;
  if (selectedTabId === undefined || selectedTabId === null) return null;
  // Cache whenever we see a valid ID
  _lastKnownSelectedTabId = selectedTabId;
  return (
    (
      Zotero as unknown as {
        Reader?: { getByTabID?: (id: string | number) => any };
      }
    ).Reader?.getByTabID?.(selectedTabId as string | number) || null
  );
}

function parseItemID(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isTabsState(value: unknown): value is ZoteroTabsState {
  if (!value || typeof value !== "object") return false;
  const obj = value as any;
  return (
    "selectedID" in obj || "selectedType" in obj || Array.isArray(obj._tabs)
  );
}

function getZoteroTabsState(): ZoteroTabsState | null {
  const candidates: unknown[] = [];
  const push = (value: unknown) => {
    candidates.push(value);
  };

  push((Zotero as unknown as { Tabs?: ZoteroTabsState }).Tabs);

  let mainWindow: any = null;
  try {
    mainWindow = Zotero.getMainWindow?.() || null;
  } catch (_error) {
    void _error;
  }
  if (mainWindow) {
    push(mainWindow.Zotero?.Tabs);
    push(mainWindow.Zotero_Tabs);
    push(mainWindow.Tabs);
  }

  let activePaneWindow: any = null;
  try {
    activePaneWindow =
      Zotero.getActiveZoteroPane?.()?.document?.defaultView || null;
  } catch (_error) {
    void _error;
  }
  if (activePaneWindow) {
    push(activePaneWindow.Zotero?.Tabs);
    push(activePaneWindow.Zotero_Tabs);
  }

  let anyMainWindow: any = null;
  try {
    const windows = Zotero.getMainWindows?.() || [];
    anyMainWindow = windows[0] || null;
  } catch (_error) {
    void _error;
  }
  if (anyMainWindow) {
    push(anyMainWindow.Zotero?.Tabs);
    push(anyMainWindow.Zotero_Tabs);
  }

  try {
    const wmRecent = (Services as any).wm?.getMostRecentWindow?.(
      "navigator:browser",
    ) as any;
    push(wmRecent?.Zotero?.Tabs);
    push(wmRecent?.Zotero_Tabs);
  } catch (_error) {
    void _error;
  }
  try {
    const wmAny = (Services as any).wm?.getMostRecentWindow?.("") as any;
    push(wmAny?.Zotero?.Tabs);
    push(wmAny?.Zotero_Tabs);
  } catch (_error) {
    void _error;
  }

  const globalAny = globalThis as any;
  push(globalAny.Zotero_Tabs);
  push(globalAny.window?.Zotero_Tabs);

  return candidates.find(isTabsState) || null;
}

/**
 * Select a Zotero tab by ID using the same fallback discovery as
 * getZoteroTabsState.  Returns true if a select() call was made.
 */
export function selectZoteroTab(tabId: string | number): boolean {
  const tabs = getZoteroTabsState();
  if (!tabs) return false;
  const tabsAny = tabs as unknown as {
    select?: (id: string | number) => void;
  };
  if (typeof tabsAny.select === "function") {
    try {
      tabsAny.select(tabId);
      return true;
    } catch (err) {
      ztoolkit.log(`[LLM] selectZoteroTab failed for "${tabId}"`, err);
    }
  }
  return false;
}

function collectCandidateItemIDsFromObject(source: any): number[] {
  if (!source || typeof source !== "object") return [];
  const directCandidates = [
    source.itemID,
    source.itemId,
    source.attachmentID,
    source.attachmentId,
    source.readerItemID,
    source.readerItemId,
    source.id,
  ];
  const nestedObjects = [
    source.item,
    source.attachment,
    source.reader,
    source.state,
    source.params,
    source.extraData,
  ];
  const out: number[] = [];
  const seen = new Set<number>();
  const pushParsed = (value: unknown) => {
    const parsed = parseItemID(value);
    if (parsed === null || seen.has(parsed)) return;
    seen.add(parsed);
    out.push(parsed);
  };

  for (const candidate of directCandidates) {
    pushParsed(candidate);
  }
  for (const nested of nestedObjects) {
    if (!nested || typeof nested !== "object") continue;
    pushParsed((nested as any).itemID);
    pushParsed((nested as any).itemId);
    pushParsed((nested as any).attachmentID);
    pushParsed((nested as any).attachmentId);
    pushParsed((nested as any).id);
  }
  return out;
}

export function getActiveContextAttachmentFromTabs(): Zotero.Item | null {
  const tabs = getZoteroTabsState();
  if (!tabs) return null;
  const selectedType = `${tabs.selectedType || ""}`.toLowerCase();
  if (selectedType && !selectedType.includes("reader")) return null;

  const selectedId =
    tabs.selectedID === undefined || tabs.selectedID === null
      ? ""
      : `${tabs.selectedID}`;
  if (!selectedId) return null;

  const tabList = Array.isArray(tabs._tabs) ? tabs._tabs : [];
  const activeTab = tabList.find((tab) => `${tab?.id || ""}` === selectedId);
  const activeType = `${activeTab?.type || ""}`.toLowerCase();
  if (!activeTab || (activeType && !activeType.includes("reader"))) return null;

  const data = activeTab.data || {};
  const candidateIDs = collectCandidateItemIDsFromObject(data);
  for (const itemId of candidateIDs) {
    const item = Zotero.Items.get(itemId);
    if (isSupportedContextAttachment(item)) return item;
  }

  // Fallback: map selected tab id to reader instance if available.
  const reader = (
    Zotero as unknown as {
      Reader?: { getByTabID?: (id: string | number) => any };
    }
  ).Reader?.getByTabID?.(selectedId);
  const readerItemId = parseItemID(reader?._item?.id ?? reader?.itemID);
  if (readerItemId !== null) {
    const readerItem = Zotero.Items.get(readerItemId);
    if (isSupportedContextAttachment(readerItem)) return readerItem;
  }

  return null;
}

function isSupportedContextAttachment(
  item: Zotero.Item | null | undefined,
): item is Zotero.Item {
  return Boolean(
    item &&
    item.isAttachment() &&
    item.attachmentContentType === "application/pdf",
  );
}

function getFirstPdfChildAttachment(
  item: Zotero.Item | null | undefined,
): Zotero.Item | null {
  if (!item || item.isAttachment()) return null;
  const attachments = item.getAttachments();
  for (const attachmentId of attachments) {
    const attachment = Zotero.Items.get(attachmentId);
    if (isSupportedContextAttachment(attachment)) {
      return attachment;
    }
  }
  return null;
}

export function resolveContextSourceItem(
  panelItem: Zotero.Item,
): ResolvedContextSource {
  const activeItem = getActiveContextAttachmentFromTabs();
  if (activeItem) {
    return { contextItem: activeItem };
  }

  if (
    panelItem.isAttachment() &&
    panelItem.attachmentContentType === "application/pdf"
  ) {
    return { contextItem: panelItem };
  }

  const parentItem =
    panelItem.isAttachment() && panelItem.parentID
      ? Zotero.Items.get(panelItem.parentID) || null
      : panelItem;
  const firstPdfChild = getFirstPdfChildAttachment(parentItem);
  if (firstPdfChild && parentItem) {
    return { contextItem: firstPdfChild };
  }

  return { contextItem: null };
}

export function getItemSelectionCacheKeys(
  item: Zotero.Item | null | undefined,
): number[] {
  if (!item) return [];
  const keys = new Set<number>();
  keys.add(item.id);
  if (item.isAttachment?.() && item.parentID) {
    keys.add(item.parentID);
  } else if (item.isRegularItem?.()) {
    try {
      const attachments = item.getAttachments();
      for (const attId of attachments) {
        const att = Zotero.Items.get(attId);
        if (att && att.attachmentContentType === "application/pdf") {
          keys.add(att.id);
        }
      }
    } catch {
      /* getAttachments() not available for this item type */
    }
  }
  return Array.from(keys);
}

function normalizeSelectedTextContexts(value: unknown): SelectedTextContext[] {
  if (Array.isArray(value)) {
    const out: SelectedTextContext[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        const normalizedText = normalizeSelectedText(entry);
        if (!normalizedText) continue;
        out.push({ text: normalizedText, source: "pdf" });
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const typed = entry as {
        text?: unknown;
        source?: unknown;
        paperContext?: unknown;
        contextItemId?: unknown;
        pageIndex?: unknown;
        pageLabel?: unknown;
      };
      const normalizedText = normalizeSelectedText(
        typeof typed.text === "string" ? typed.text : "",
      );
      if (!normalizedText) continue;
      const normalizedPaperContext = normalizePaperContextRefs([
        typed.paperContext,
      ])[0];
      const contextItemId =
        normalizePositiveInt(typed.contextItemId) || undefined;
      const rawPageIndex = Number(typed.pageIndex);
      const pageIndex =
        Number.isFinite(rawPageIndex) && rawPageIndex >= 0
          ? Math.floor(rawPageIndex)
          : undefined;
      const pageLabel =
        typeof typed.pageLabel === "string" && typed.pageLabel.trim()
          ? typed.pageLabel.trim()
          : pageIndex !== undefined
            ? `${pageIndex + 1}`
            : undefined;
      out.push({
        text: normalizedText,
        source: normalizeSelectedTextSource(typed.source),
        paperContext: normalizedPaperContext,
        contextItemId,
        pageIndex,
        pageLabel,
      });
    }
    return out;
  }
  if (typeof value === "string") {
    const normalized = normalizeSelectedText(value);
    return normalized ? [{ text: normalized, source: "pdf" }] : [];
  }
  return [];
}

export function getSelectedTextContextEntries(
  itemId: number,
): SelectedTextContext[] {
  const raw = selectedTextCache.get(itemId);
  return normalizeSelectedTextContexts(raw);
}

function normalizeSelectedTextPageLocation(
  location?: SelectedTextPageLocation | null,
): SelectedTextPageLocation | undefined {
  if (!location || typeof location !== "object") return undefined;
  const contextItemId =
    normalizePositiveInt(location.contextItemId) || undefined;
  const rawPageIndex = Number(location.pageIndex);
  const pageIndex =
    Number.isFinite(rawPageIndex) && rawPageIndex >= 0
      ? Math.floor(rawPageIndex)
      : undefined;
  const pageLabel =
    typeof location.pageLabel === "string" && location.pageLabel.trim()
      ? location.pageLabel.trim()
      : pageIndex !== undefined
        ? `${pageIndex + 1}`
        : undefined;
  if (
    contextItemId === undefined &&
    pageIndex === undefined &&
    pageLabel === undefined
  ) {
    return undefined;
  }
  return {
    contextItemId,
    pageIndex,
    pageLabel,
  };
}

function buildSelectedTextContext(
  text: string,
  source: SelectedTextSource,
  paperContext?: PaperContextRef | null,
  location?: SelectedTextPageLocation | null,
): SelectedTextContext {
  const normalizedPaperContext = normalizePaperContextRefs([paperContext])[0];
  const normalizedLocation = normalizeSelectedTextPageLocation(location);
  return {
    text,
    source: normalizeSelectedTextSource(source),
    paperContext: normalizedPaperContext,
    contextItemId: normalizedLocation?.contextItemId,
    pageIndex: normalizedLocation?.pageIndex,
    pageLabel: normalizedLocation?.pageLabel,
  };
}

export function formatSelectedTextContextPageLabel(
  context: SelectedTextContext,
): string | null {
  if (
    !Number.isFinite(context.pageIndex) ||
    (context.pageIndex as number) < 0
  ) {
    return null;
  }
  const label =
    typeof context.pageLabel === "string" && context.pageLabel.trim()
      ? context.pageLabel.trim()
      : `${Math.floor(context.pageIndex as number) + 1}`;
  return `page ${label}`;
}

export function setSelectedTextContextEntries(
  itemId: number,
  contexts: SelectedTextContext[],
): void {
  const normalized = normalizeSelectedTextContexts(contexts);
  if (!normalized.length) {
    selectedTextCache.delete(itemId);
    selectedTextPreviewExpandedCache.delete(itemId);
    return;
  }
  selectedTextCache.set(itemId, normalized);
}

export function appendSelectedTextContextForItem(
  itemId: number,
  text: string,
  source: SelectedTextSource = "pdf",
  paperContext?: PaperContextRef | null,
  location?: SelectedTextPageLocation | null,
): boolean {
  const normalizedText = normalizeSelectedText(text || "");
  if (!normalizedText) return false;
  const existingContexts = getSelectedTextContextEntries(itemId);
  const dedupeKey = (entry: SelectedTextContext): string => {
    const sourceKey = entry.source;
    const paperKey = entry.paperContext
      ? `${entry.paperContext.itemId}:${entry.paperContext.contextItemId}`
      : "-";
    const contextItemId = Number.isFinite(entry.contextItemId)
      ? Math.floor(entry.contextItemId as number)
      : 0;
    const pageIndex = Number.isFinite(entry.pageIndex)
      ? Math.floor(entry.pageIndex as number)
      : -1;
    return `${sourceKey}\u241f${entry.text}\u241f${paperKey}\u241f${contextItemId}\u241f${pageIndex}`;
  };
  const incomingEntry = buildSelectedTextContext(
    normalizedText,
    source,
    paperContext,
    location,
  );
  const incomingKey = dedupeKey(incomingEntry);
  if (existingContexts.some((entry) => dedupeKey(entry) === incomingKey)) {
    return false;
  }
  if (existingContexts.length >= MAX_SELECTED_TEXT_CONTEXTS) return false;
  setSelectedTextContextEntries(itemId, [...existingContexts, incomingEntry]);
  selectedTextPreviewExpandedCache.delete(itemId);
  return true;
}

export function getSelectedTextExpandedIndex(
  itemId: number,
  count: number,
): number {
  const raw = selectedTextPreviewExpandedCache.get(itemId);
  const normalized = (() => {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.floor(raw);
    }
    return -1;
  })();
  if (normalized < 0 || normalized >= count) {
    selectedTextPreviewExpandedCache.delete(itemId);
    return -1;
  }
  return normalized;
}

export function setSelectedTextExpandedIndex(
  itemId: number,
  index: number | null,
): void {
  if (index === null || index < 0 || !Number.isFinite(index)) {
    selectedTextPreviewExpandedCache.delete(itemId);
    return;
  }
  selectedTextPreviewExpandedCache.set(itemId, Math.floor(index));
}

type AddSelectedTextContextOptions = {
  noSelectionStatusText?: string;
  successStatusText?: string;
  focusInput?: boolean;
  source?: SelectedTextSource;
  paperContext?: PaperContextRef | null;
  location?: SelectedTextPageLocation | null;
};

export function addSelectedTextContext(
  body: Element,
  itemId: number,
  text: string,
  options: AddSelectedTextContextOptions = {},
): boolean {
  const normalizedText = normalizeSelectedText(text || "");
  const status = body.querySelector("#llm-status") as HTMLElement | null;
  if (!normalizedText) {
    if (status && options.noSelectionStatusText) {
      setStatus(status, options.noSelectionStatusText, "error");
    }
    return false;
  }

  const appended = appendSelectedTextContextForItem(
    itemId,
    normalizedText,
    options.source || "pdf",
    options.paperContext,
    options.location,
  );
  if (!appended) {
    if (status) setStatus(status, "Text Context up to 5", "error");
    return false;
  }
  applySelectedTextPreview(body, itemId);
  if (status && options.successStatusText) {
    setStatus(status, options.successStatusText, "ready");
  }
  if (options.focusInput !== false) {
    const inputEl = body.querySelector(
      "#llm-input",
    ) as HTMLTextAreaElement | null;
    inputEl?.focus({ preventScroll: true });
  }
  return true;
}

export function applySelectedTextPreview(body: Element, itemId: number) {
  const previewList = body.querySelector(
    "#llm-selected-context-list",
  ) as HTMLDivElement | null;
  if (!previewList) return;

  const selectedContexts = getSelectedTextContextEntries(itemId);
  prunePinnedSelectedTextKeys(pinnedSelectedTextKeys, itemId, selectedContexts);
  if (!selectedContexts.length) {
    previewList.style.display = "none";
    previewList.innerHTML = "";
    selectedTextPreviewExpandedCache.delete(itemId);
    return;
  }

  const ownerDoc = body.ownerDocument;
  if (!ownerDoc) return;

  const expandedIndex = getSelectedTextExpandedIndex(
    itemId,
    selectedContexts.length,
  );
  previewList.style.display = "contents";
  previewList.innerHTML = "";

  for (const [index, selectedContext] of selectedContexts.entries()) {
    const selectedText = selectedContext.text;
    const selectedSource = selectedContext.source;
    const isExpanded = expandedIndex === index;
    const pinned = isPinnedSelectedText(
      pinnedSelectedTextKeys,
      itemId,
      selectedContext,
    );
    const contextLabel = (() => {
      const pageLabel = formatSelectedTextContextPageLabel(selectedContext);
      if (selectedSource === "pdf" && pageLabel) {
        return pageLabel;
      }
      return selectedContexts.length > 1 && index > 0
        ? `Text Context (${index + 1})`
        : "Text Context";
    })();

    const previewBox = ownerDoc.createElement("div");
    previewBox.className = "llm-selected-context";
    previewBox.dataset.contextIndex = `${index}`;
    previewBox.dataset.contextSource = selectedSource;
    previewBox.classList.toggle("expanded", isExpanded);
    previewBox.classList.toggle("collapsed", !isExpanded);
    previewBox.classList.toggle(
      "llm-selected-context-source-pdf",
      selectedSource === "pdf",
    );
    previewBox.classList.toggle(
      "llm-selected-context-source-model",
      selectedSource === "model",
    );
    previewBox.classList.toggle("llm-selected-context-pinned", pinned);
    previewBox.dataset.pinned = pinned ? "true" : "false";
    previewBox.dataset.contextPinKey =
      buildPinnedSelectedTextKey(selectedContext);

    const previewHeader = ownerDoc.createElement("div");
    previewHeader.className =
      "llm-image-preview-header llm-selected-context-header";

    const previewMeta = ownerDoc.createElement("button");
    previewMeta.type = "button";
    previewMeta.className = "llm-image-preview-meta llm-selected-context-meta";
    previewMeta.dataset.contextIndex = `${index}`;
    previewMeta.dataset.contextSource = selectedSource;
    previewMeta.classList.toggle(
      "llm-selected-context-source-pdf",
      selectedSource === "pdf",
    );
    previewMeta.classList.toggle(
      "llm-selected-context-source-model",
      selectedSource === "model",
    );
    previewMeta.textContent = contextLabel;
    const isCorrupted = isLikelyCorruptedSelectedText(selectedText);
    previewMeta.classList.toggle(
      "llm-selected-context-meta-corrupted",
      isCorrupted,
    );
    const pageLabel = formatSelectedTextContextPageLabel(selectedContext);
    const isJumpablePdfContext =
      selectedSource === "pdf" &&
      Number.isFinite(selectedContext.pageIndex) &&
      (selectedContext.pageIndex as number) >= 0;
    previewMeta.title = isJumpablePdfContext
      ? `Jump to ${pageLabel || "page"}`
      : isExpanded
        ? "Collapse text context"
        : "Expand text context";
    previewMeta.setAttribute(
      "aria-expanded",
      isJumpablePdfContext ? "false" : isExpanded ? "true" : "false",
    );
    previewMeta.dataset.contextPageIndex = Number.isFinite(
      selectedContext.pageIndex,
    )
      ? `${Math.floor(selectedContext.pageIndex as number)}`
      : "";
    previewMeta.dataset.contextPageLabel = selectedContext.pageLabel || "";
    previewMeta.dataset.contextItemId = Number.isFinite(
      selectedContext.contextItemId,
    )
      ? `${Math.floor(selectedContext.contextItemId as number)}`
      : "";

    previewHeader.appendChild(previewMeta);
    const previewClear = ownerDoc.createElement("button");
    previewClear.type = "button";
    previewClear.className = "llm-remove-img-btn llm-selected-context-clear";
    previewClear.dataset.contextIndex = `${index}`;
    previewClear.textContent = "×";
    previewClear.title = "Clear selected context";
    previewClear.setAttribute("aria-label", "Clear selected context");
    previewHeader.appendChild(previewClear);

    const previewExpanded = ownerDoc.createElement("div");
    previewExpanded.className =
      "llm-image-preview-expanded llm-selected-context-expanded";
    previewExpanded.hidden = false;
    previewExpanded.style.display = "flex";

    const previewText = ownerDoc.createElement("div");
    previewText.className = "llm-selected-context-text";
    previewText.textContent = selectedText;

    const previewWarning = ownerDoc.createElement("div");
    previewWarning.className = "llm-selected-context-warning";
    previewWarning.textContent =
      "Use PDF page or image context for corrupted text";
    previewWarning.style.display = isCorrupted ? "block" : "none";

    previewExpanded.append(previewText, previewWarning);
    previewBox.append(previewHeader, previewExpanded);
    previewList.appendChild(previewBox);
  }
}
