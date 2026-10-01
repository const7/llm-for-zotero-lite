import { config } from "../../package.json";
import { CodexRpc, type CodexProcess } from "./rpc";
import { spawnCodex } from "./process";

export const CODEX_PANEL_LEVELS = ["low", "medium", "high"] as const;
export type CodexPanelLevel = (typeof CODEX_PANEL_LEVELS)[number];
export type CodexModel = {
  model: string;
  displayName: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
  hidden: boolean;
};

const cacheKey = `${config.prefsPrefix}.codexModelCatalog`;
let pending: Promise<CodexModel[]> | undefined;
let activeRpc: CodexRpc | undefined;
let generation = 0;

function binaryPath(): string {
  return String(
    Zotero.Prefs.get(`${config.prefsPrefix}.codexBinaryPath`, true) || "",
  );
}

export function getCachedCodexModels(): CodexModel[] {
  const raw = Zotero.Prefs.get(cacheKey, true);
  if (typeof raw !== "string" || !raw) return [];
  try {
    const cached = JSON.parse(raw);
    return cached.binaryPath === binaryPath() && Array.isArray(cached.models)
      ? cached.models
      : [];
  } catch {
    return [];
  }
}

export function getCodexReasoningOptions(model: string) {
  const metadata = getCachedCodexModels().find(
    (entry) => entry.model === model,
  );
  return CODEX_PANEL_LEVELS.filter((level) =>
    metadata?.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === level,
    ),
  ).map((level) => ({ level, label: level, enabled: true }));
}

export function resolveCodexEffort(
  model: CodexModel,
  requested?: string,
): CodexPanelLevel | undefined {
  const supported = CODEX_PANEL_LEVELS.filter((level) =>
    model.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === level,
    ),
  );
  const bounded =
    requested === "minimal"
      ? "low"
      : requested === "xhigh" || requested === "max" || requested === "ultra"
        ? "high"
        : requested;
  return (
    supported.find((level) => level === bounded) ||
    supported.find((level) => level === model.defaultReasoningEffort) ||
    supported[0]
  );
}

export async function readCodexModels(rpc: CodexRpc): Promise<CodexModel[]> {
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: CodexModel[]; nextCursor: string | null } =
      await rpc.request("model/list", { cursor, includeHidden: false });
    models.push(
      ...page.data
        .filter((model) => !model.hidden)
        .map((model) => ({
          model: model.model,
          displayName: model.displayName,
          supportedReasoningEfforts: model.supportedReasoningEfforts,
          defaultReasoningEffort: model.defaultReasoningEffort,
          hidden: model.hidden,
        })),
    );
    cursor = page.nextCursor;
  } while (cursor);
  return models;
}

export function refreshCodexModels(
  launch: () => Promise<CodexProcess> = spawnCodex,
): Promise<CodexModel[]> {
  if (pending) return pending;
  const path = binaryPath();
  const started = generation;
  pending = (async () => {
    const rpc = new CodexRpc(await launch());
    activeRpc = rpc;
    try {
      if (started !== generation) throw new Error("Plugin shutdown");
      await rpc.request("initialize", {
        clientInfo: { name: "llm-for-zotero-lite", version: "1.0" },
        capabilities: { experimentalApi: true },
      });
      await rpc.notify("initialized");
      const models = await readCodexModels(rpc);
      if (path === binaryPath()) {
        Zotero.Prefs.set(
          cacheKey,
          JSON.stringify({ binaryPath: path, models }),
          true,
        );
      }
      return models;
    } finally {
      rpc.close();
      activeRpc = undefined;
    }
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}

export function stopCodexModelRefresh(): void {
  generation += 1;
  activeRpc?.close(new Error("Plugin shutdown"));
}
