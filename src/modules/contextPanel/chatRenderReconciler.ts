import type { Message } from "./types";

export type ChatRenderedMessageState = {
  domKey: string;
  renderKey: string;
};

export function buildChatMessageDomKey(
  index: number,
  message: Pick<Message, "role" | "timestamp">,
): string {
  return `${index}:${message.role}:${Math.floor(Number(message.timestamp) || 0)}`;
}

export function countReusableChatMessagePrefix(
  previous: ChatRenderedMessageState[],
  next: ChatRenderedMessageState[],
): number {
  let reusable = 0;
  const max = Math.min(previous.length, next.length);
  while (reusable < max) {
    const prior = previous[reusable];
    const current = next[reusable];
    if (!prior || !current) break;
    if (prior.domKey !== current.domKey) break;
    if (prior.renderKey !== current.renderKey) break;
    reusable += 1;
  }
  return reusable;
}
