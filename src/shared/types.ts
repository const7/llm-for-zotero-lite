/**
 * Shared domain types for the lean paper-chat runtime.
 * This file has zero imports — all types are pure data shapes.
 */

export type SelectedTextSource = "pdf" | "model";

export type ChatAttachmentCategory =
  | "image"
  | "pdf"
  | "markdown"
  | "code"
  | "text"
  | "file";

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  category: ChatAttachmentCategory;
  imageDataUrl?: string;
  textContent?: string;
  storedPath?: string;
  contentHash?: string;
};

export type AdvancedModelParams = {
  temperature: number;
  maxTokens: number;
  inputTokenCap?: number;
};

export type PaperContextRef = {
  itemId: number;
  contextItemId: number;
  citationKey?: string;
  title: string;
  attachmentTitle?: string;
  firstCreator?: string;
  year?: string;
  /** Full path to MinerU parsed cache directory (contains full.md + images/). */
  mineruCacheDir?: string;
};

/** A non-PDF file attachment (image/figure or other file) selected as reference context. */
export type OtherContextRef = {
  contextItemId: number;
  parentItemId?: number;
  title: string;
  contentType: string;
  refKind: "figure" | "other";
};

export type PaperConversationSummary = {
  conversationKey: number;
  libraryID: number;
  paperItemID: number;
  sessionVersion: number;
  createdAt: number;
  title?: string;
  lastActivityAt: number;
  userTurnCount: number;
};
