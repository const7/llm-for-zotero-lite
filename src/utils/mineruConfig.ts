import { config } from "../../package.json";

const MINERU_ENABLED_KEY = `${config.prefsPrefix}.mineruEnabled`;

export function isMineruEnabled(): boolean {
  const value = Zotero.Prefs.get(MINERU_ENABLED_KEY, true);
  return value === true || `${value || ""}`.toLowerCase() === "true";
}

export function setMineruEnabled(value: boolean): void {
  Zotero.Prefs.set(MINERU_ENABLED_KEY, value, true);
}
