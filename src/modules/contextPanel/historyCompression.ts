import type { ChatMessage } from "../../utils/llmClient";
import { sanitizeText } from "./textUtils";

const SUMMARY_TRIGGER_PAIRS = 10;
const SUMMARY_RETAIN_PAIRS = 5;
const USER_EXCERPT_LEN = 250;
const ASSISTANT_EXCERPT_LEN = 400;

export function compressLongHistory(messages: ChatMessage[]): ChatMessage[] {
  const totalPairs = Math.floor(messages.length / 2);
  if (totalPairs <= SUMMARY_TRIGGER_PAIRS) return messages;

  const retainCount = SUMMARY_RETAIN_PAIRS * 2;
  const splitAt = messages.length - retainCount;
  const toSummarize = messages.slice(0, splitAt);
  const toKeep = messages.slice(splitAt);
  const summaryText = buildRuleBasedSummary(toSummarize);

  const summaryPair: ChatMessage[] = [
    {
      role: "user",
      content: `[Earlier conversation summarized]\n${summaryText}`,
    },
    {
      role: "assistant",
      content: "Understood. I have the earlier conversation context.",
    },
  ];
  return [...summaryPair, ...toKeep];
}

function buildRuleBasedSummary(messages: ChatMessage[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < messages.length; i += 2) {
    const user = messages[i];
    const assistant = messages[i + 1];
    if (!user || !assistant) continue;
    const userText = sanitizeText(
      typeof user.content === "string" ? user.content : "",
    ).slice(0, USER_EXCERPT_LEN);
    const assistantText = sanitizeText(
      typeof assistant.content === "string" ? assistant.content : "",
    ).slice(0, ASSISTANT_EXCERPT_LEN);
    pairs.push(
      `User: ${userText}${userText.length >= USER_EXCERPT_LEN ? "…" : ""}\n` +
        `Assistant: ${assistantText}${assistantText.length >= ASSISTANT_EXCERPT_LEN ? "…" : ""}`,
    );
  }
  if (!pairs.length) return "";
  return `Earlier conversation (${pairs.length} exchange${pairs.length === 1 ? "" : "s"}):\n\n${pairs.join("\n\n")}`;
}
