const PROGRESSIVE_CHAT_RENDER_THRESHOLD = 48;
export const PROGRESSIVE_CHAT_RENDER_WINDOW_SIZE = 24;
export const PROGRESSIVE_CHAT_RENDER_BATCH_SIZE = 24;
export const OLDER_CHAT_BACKFILL_TOP_THRESHOLD_PX = 16;

export function resolveChatRenderStartIndex(params: {
  historyLength: number;
  existingConversationKey: number;
  conversationKey: number;
  existingStartIndex: number;
  hasExistingRenderedContent: boolean;
  scrollMode: "followBottom" | "manual";
}): number {
  const historyLength = Math.max(0, Math.floor(params.historyLength));
  if (historyLength === 0) return 0;

  const existingStartIndex = Math.max(
    0,
    Math.min(historyLength - 1, Math.floor(params.existingStartIndex || 0)),
  );
  if (
    params.existingConversationKey === params.conversationKey &&
    params.hasExistingRenderedContent &&
    existingStartIndex > 0
  ) {
    return existingStartIndex;
  }

  if (params.hasExistingRenderedContent) return 0;
  if (params.scrollMode !== "followBottom") return 0;
  if (historyLength <= PROGRESSIVE_CHAT_RENDER_THRESHOLD) return 0;
  return Math.max(0, historyLength - PROGRESSIVE_CHAT_RENDER_WINDOW_SIZE);
}

export function getNextBackfillStartIndex(currentStartIndex: number): number {
  const normalized = Math.max(0, Math.floor(currentStartIndex || 0));
  return Math.max(0, normalized - PROGRESSIVE_CHAT_RENDER_BATCH_SIZE);
}

export function shouldBackfillOlderChatMessages(params: {
  renderedStartIndex: number;
  scrollTop: number;
}): boolean {
  return (
    Math.max(0, Math.floor(params.renderedStartIndex || 0)) > 0 &&
    Math.max(0, params.scrollTop || 0) <= OLDER_CHAT_BACKFILL_TOP_THRESHOLD_PX
  );
}
