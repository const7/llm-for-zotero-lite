import { config } from "../modules/contextPanel/constants";

const LEGACY_PREF_KEY = "lastUsedPaperConversationMap";
const PAPER_CONVERSATION_SESSION_TABLE =
  "llm_for_zotero_paper_conversation_state";
const PAPER_CONVERSATION_SESSION_CONVERSATION_INDEX =
  "llm_for_zotero_paper_conversation_state_conversation_idx";

type ZoteroPrefsAPI = {
  get?: (key: string, global?: boolean) => unknown;
  set?: (key: string, value: unknown, global?: boolean) => void;
  clear?: (key: string, global?: boolean) => void;
};

const rememberedPaperConversationByPaper = new Map<string, number>();
let initialized = false;
let initializationPromise: Promise<void> | null = null;

function normalizePositiveInt(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function buildPaperSessionStateKey(
  libraryID: number,
  paperItemID: number,
): string {
  return `${Math.floor(libraryID)}:${Math.floor(paperItemID)}`;
}

function getZoteroPrefs(): ZoteroPrefsAPI | null {
  return (
    (Zotero as unknown as { Prefs?: ZoteroPrefsAPI } | undefined)?.Prefs || null
  );
}

function readLegacyPrefMap(): Record<string, number> {
  const raw = getZoteroPrefs()?.get?.(
    `${config.prefsPrefix}.${LEGACY_PREF_KEY}`,
    true,
  );
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizePositiveInt(Number(value));
      if (!normalized) continue;
      out[key] = normalized;
    }
    return out;
  } catch (_err) {
    return {};
  }
}

function clearLegacyPref(): void {
  const fullKey = `${config.prefsPrefix}.${LEGACY_PREF_KEY}`;
  const prefs = getZoteroPrefs();
  if (typeof prefs?.clear === "function") {
    prefs.clear(fullKey, true);
    return;
  }
  prefs?.set?.(fullKey, "", true);
}

async function ensurePaperConversationSessionTable(): Promise<void> {
  await Zotero.DB.queryAsync(
    `CREATE TABLE IF NOT EXISTS ${PAPER_CONVERSATION_SESSION_TABLE} (
      library_id INTEGER NOT NULL,
      paper_item_id INTEGER NOT NULL,
      conversation_key INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (library_id, paper_item_id)
    )`,
  );
  await Zotero.DB.queryAsync(
    `CREATE INDEX IF NOT EXISTS ${PAPER_CONVERSATION_SESSION_CONVERSATION_INDEX}
     ON ${PAPER_CONVERSATION_SESSION_TABLE} (conversation_key, updated_at DESC)`,
  );
}

async function loadRememberedPaperConversationsFromDb(): Promise<void> {
  const rows = (await Zotero.DB.queryAsync(
    `SELECT library_id AS libraryID,
            paper_item_id AS paperItemID,
            conversation_key AS conversationKey
     FROM ${PAPER_CONVERSATION_SESSION_TABLE}`,
  )) as
    | Array<{
        libraryID?: unknown;
        paperItemID?: unknown;
        conversationKey?: unknown;
      }>
    | undefined;

  rememberedPaperConversationByPaper.clear();
  for (const row of rows || []) {
    const libraryID = normalizePositiveInt(Number(row.libraryID));
    const paperItemID = normalizePositiveInt(Number(row.paperItemID));
    const conversationKey = normalizePositiveInt(Number(row.conversationKey));
    if (!libraryID || !paperItemID || !conversationKey) continue;
    rememberedPaperConversationByPaper.set(
      buildPaperSessionStateKey(libraryID, paperItemID),
      conversationKey,
    );
  }
}

async function migrateLegacyPrefMap(): Promise<void> {
  const legacyMap = readLegacyPrefMap();
  const entries = Object.entries(legacyMap);
  if (!entries.length) return;
  const updatedAt = Date.now();
  for (const [key, conversationKey] of entries) {
    const [libraryRaw, paperRaw] = key.split(":");
    const libraryID = normalizePositiveInt(Number(libraryRaw));
    const paperItemID = normalizePositiveInt(Number(paperRaw));
    const normalizedConversationKey = normalizePositiveInt(
      Number(conversationKey),
    );
    if (!libraryID || !paperItemID || !normalizedConversationKey) continue;
    await Zotero.DB.queryAsync(
      `INSERT INTO ${PAPER_CONVERSATION_SESSION_TABLE}
        (library_id, paper_item_id, conversation_key, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(library_id, paper_item_id) DO UPDATE SET
         conversation_key = excluded.conversation_key,
         updated_at = excluded.updated_at`,
      [libraryID, paperItemID, normalizedConversationKey, updatedAt],
    );
  }
  clearLegacyPref();
}

async function persistRememberedPaperConversation(
  libraryID: number,
  paperItemID: number,
  conversationKey: number,
): Promise<void> {
  await Zotero.DB.queryAsync(
    `INSERT INTO ${PAPER_CONVERSATION_SESSION_TABLE}
      (library_id, paper_item_id, conversation_key, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(library_id, paper_item_id) DO UPDATE SET
       conversation_key = excluded.conversation_key,
       updated_at = excluded.updated_at`,
    [libraryID, paperItemID, conversationKey, Date.now()],
  );
}

async function deleteRememberedPaperConversation(
  libraryID: number,
  paperItemID: number,
): Promise<void> {
  await Zotero.DB.queryAsync(
    `DELETE FROM ${PAPER_CONVERSATION_SESSION_TABLE}
     WHERE library_id = ?
       AND paper_item_id = ?`,
    [libraryID, paperItemID],
  );
}

function logStoreFailure(message: string, err: unknown): void {
  try {
    ztoolkit.log(message, err);
  } catch (_logErr) {
    void _logErr;
  }
}

export async function initRememberedPaperConversationStore(): Promise<void> {
  if (initialized) return;
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    await ensurePaperConversationSessionTable();
    await migrateLegacyPrefMap();
    await loadRememberedPaperConversationsFromDb();
    initialized = true;
  })();
  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

export function getRememberedPaperConversationKey(
  libraryID: number,
  paperItemID: number,
): number | null {
  const normalizedLibraryID = normalizePositiveInt(libraryID);
  const normalizedPaperItemID = normalizePositiveInt(paperItemID);
  if (!normalizedLibraryID || !normalizedPaperItemID) return null;
  const key = buildPaperSessionStateKey(
    normalizedLibraryID,
    normalizedPaperItemID,
  );
  const remembered = normalizePositiveInt(
    Number(rememberedPaperConversationByPaper.get(key)),
  );
  return remembered || null;
}

export function setRememberedPaperConversationKey(
  libraryID: number,
  paperItemID: number,
  conversationKey: number,
): void {
  const normalizedLibraryID = normalizePositiveInt(libraryID);
  const normalizedPaperItemID = normalizePositiveInt(paperItemID);
  const normalizedConversationKey = normalizePositiveInt(conversationKey);
  if (
    !normalizedLibraryID ||
    !normalizedPaperItemID ||
    !normalizedConversationKey
  ) {
    return;
  }
  const stateKey = buildPaperSessionStateKey(
    normalizedLibraryID,
    normalizedPaperItemID,
  );
  if (
    rememberedPaperConversationByPaper.get(stateKey) ===
    normalizedConversationKey
  ) {
    return;
  }
  rememberedPaperConversationByPaper.set(stateKey, normalizedConversationKey);
  if (!initialized) return;
  void persistRememberedPaperConversation(
    normalizedLibraryID,
    normalizedPaperItemID,
    normalizedConversationKey,
  ).catch((err) => {
    logStoreFailure(
      "LLM: Failed to persist remembered paper conversation",
      err,
    );
  });
}

export function removeRememberedPaperConversationKey(
  libraryID: number,
  paperItemID: number,
): void {
  const normalizedLibraryID = normalizePositiveInt(libraryID);
  const normalizedPaperItemID = normalizePositiveInt(paperItemID);
  if (!normalizedLibraryID || !normalizedPaperItemID) return;
  const stateKey = buildPaperSessionStateKey(
    normalizedLibraryID,
    normalizedPaperItemID,
  );
  if (!rememberedPaperConversationByPaper.delete(stateKey)) return;
  if (!initialized) return;
  void deleteRememberedPaperConversation(
    normalizedLibraryID,
    normalizedPaperItemID,
  ).catch((err) => {
    logStoreFailure("LLM: Failed to clear remembered paper conversation", err);
  });
}

export function resetRememberedPaperConversationStoreForTests(): void {
  rememberedPaperConversationByPaper.clear();
  initialized = false;
  initializationPromise = null;
}
