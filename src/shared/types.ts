/**
 * Shared domain types used by both the agent layer and the contextPanel layer.
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
};

export type ActiveNoteSession = {
  noteKind: "item" | "standalone";
  noteId: number;
  title: string;
  parentItemId?: number;
  displayConversationKind: "paper" | "global";
  capabilities: {
    showModeSwitch: boolean;
    showNewConversation: boolean;
    showHistory: boolean;
    showOpenLock: boolean;
  };
};

export type ActiveNoteContext = {
  noteId: number;
  title: string;
  noteKind: "item" | "standalone";
  parentItemId?: number;
  noteText: string;
};

export type GlobalConversationSummary = {
  conversationKey: number;
  libraryID: number;
  createdAt: number;
  title?: string;
  lastActivityAt: number;
  userTurnCount: number;
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
