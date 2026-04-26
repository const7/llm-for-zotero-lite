import { sanitizeText } from "../../textUtils";

export const PAPER_HISTORY_UNDO_WINDOW_MS = 6_000;
const PAPER_HISTORY_TITLE_MAX_LENGTH = 64;
const HISTORY_ROW_TITLE_MAX_LENGTH = 42;

export type ConversationHistoryEntry = {
  conversationKey: number;
  title: string;
  timestampText: string;
  deletable: boolean;
  isDraft: boolean;
  isPendingDelete: boolean;
  lastActivityAt: number;
  paperItemID?: number;
  sessionVersion?: number;
};

export type HistorySwitchTarget = { conversationKey: number } | null;

export type PendingHistoryDeletion = {
  conversationKey: number;
  libraryID: number;
  paperItemID?: number;
  title: string;
  wasActive: boolean;
  fallbackTarget: HistorySwitchTarget;
  expiresAt: number;
  timeoutId: number | null;
};

export function formatPaperHistoryTimestamp(timestamp: number): string {
  try {
    const parsed = Number(timestamp);
    if (!Number.isFinite(parsed) || parsed <= 0) return "";
    return new Intl.DateTimeFormat(undefined, {
      year: "2-digit",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch (_err) {
    return "";
  }
}

export function normalizeConversationTitleSeed(
  raw: unknown,
  maxLength = PAPER_HISTORY_TITLE_MAX_LENGTH,
): string {
  const normalized = sanitizeText(String(raw || ""))
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 3) {
    return normalized;
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

export function normalizeHistoryTitle(raw: unknown): string {
  return normalizeConversationTitleSeed(raw, PAPER_HISTORY_TITLE_MAX_LENGTH);
}

export function formatHistoryRowDisplayTitle(title: string): string {
  return (
    normalizeConversationTitleSeed(title, HISTORY_ROW_TITLE_MAX_LENGTH) ||
    "Untitled chat"
  );
}
