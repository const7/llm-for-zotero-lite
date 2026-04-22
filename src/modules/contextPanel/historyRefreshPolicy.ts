export type ConversationHistoryRefreshMode =
  | "selection"
  | "mutation"
  | "menu-open";

export function shouldReloadConversationHistoryMenu(
  mode: ConversationHistoryRefreshMode,
  isHistoryMenuOpen: boolean,
): boolean {
  return mode === "menu-open" || isHistoryMenuOpen;
}

export function shouldNotifyConversationHistoryConsumers(
  mode: ConversationHistoryRefreshMode,
): boolean {
  return mode !== "selection";
}
