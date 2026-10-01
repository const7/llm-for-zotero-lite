import { joinLocalPath } from "./localPath";

export function getZoteroDataDir(): string {
  const dir = Zotero.DataDirectory?.dir;
  if (!dir?.trim()) throw new Error("Zotero data directory is unavailable");
  return dir;
}

export function getPluginDataDir(...parts: string[]): string {
  return joinLocalPath(getZoteroDataDir(), "llm-for-zotero-lite", ...parts);
}
