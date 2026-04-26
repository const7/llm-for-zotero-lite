import type {
  SelectedTextSource,
  PaperContextRef,
  PaperConversationSummary,
} from "../shared/types";
import { PAPER_CONVERSATION_KEY_BASE } from "../modules/contextPanel/constants";
import {
  normalizeSelectedTextPaperContexts,
  normalizeSelectedTextSource,
  normalizePaperContextRefs,
} from "../modules/contextPanel/normalizers";
import { initRememberedPaperConversationStore } from "./paperConversationSessionStore";

export type StoredChatMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  selectedTexts?: string[];
  selectedTextSources?: SelectedTextSource[];
  selectedTextPaperContexts?: (PaperContextRef | undefined)[];
  paperContexts?: PaperContextRef[];
  fullTextPaperContexts?: PaperContextRef[];
  screenshotImages?: string[];
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    category: "image" | "pdf" | "markdown" | "code" | "text" | "file";
    imageDataUrl?: string;
    textContent?: string;
    storedPath?: string;
    contentHash?: string;
  }>;
  modelName?: string;
  modelEntryId?: string;
  modelProviderLabel?: string;
  webchatRunState?: "done" | "incomplete" | "error";
  webchatCompletionReason?:
    | "settled"
    | "forced_cancel"
    | "timeout"
    | "error"
    | null;
  reasoningSummary?: string;
  reasoningDetails?: string;
};

const CHAT_MESSAGES_TABLE = "llm_for_zotero_chat_messages";
const CHAT_MESSAGES_INDEX = "llm_for_zotero_chat_messages_conversation_idx";
const TEMP_CHAT_MESSAGES_TABLE = `${CHAT_MESSAGES_TABLE}_old`;
const PAPER_CONVERSATIONS_TABLE = "llm_for_zotero_paper_conversations";
const PAPER_CONVERSATIONS_PAPER_INDEX =
  "llm_for_zotero_paper_conversations_paper_idx";
const PAPER_CONVERSATIONS_CONVERSATION_INDEX =
  "llm_for_zotero_paper_conversations_conversation_idx";
const CHAT_MESSAGE_COLUMNS = [
  "id",
  "conversation_key",
  "role",
  "text",
  "timestamp",
  "selected_texts_json",
  "selected_text_sources_json",
  "selected_text_paper_contexts_json",
  "paper_contexts_json",
  "full_text_paper_contexts_json",
  "screenshot_images",
  "attachments_json",
  "model_name",
  "model_entry_id",
  "model_provider_label",
  "webchat_run_state",
  "webchat_completion_reason",
  "reasoning_summary",
  "reasoning_details",
] as const;

const CHAT_MESSAGES_CREATE_SQL = `CREATE TABLE IF NOT EXISTS ${CHAT_MESSAGES_TABLE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_key INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  selected_texts_json TEXT,
  selected_text_sources_json TEXT,
  selected_text_paper_contexts_json TEXT,
  paper_contexts_json TEXT,
  full_text_paper_contexts_json TEXT,
  screenshot_images TEXT,
  attachments_json TEXT,
  model_name TEXT,
  model_entry_id TEXT,
  model_provider_label TEXT,
  webchat_run_state TEXT,
  webchat_completion_reason TEXT,
  reasoning_summary TEXT,
  reasoning_details TEXT
)`;

async function getTableColumnNames(tableName: string): Promise<string[]> {
  const columns = (await Zotero.DB.queryAsync(
    `PRAGMA table_info(${tableName})`,
  )) as Array<{ name?: unknown }> | undefined;
  return (columns || [])
    .map((column) => (typeof column.name === "string" ? column.name : ""))
    .filter(Boolean);
}

async function rebuildChatMessagesTableIfNeeded(): Promise<void> {
  const existingColumns = await getTableColumnNames(CHAT_MESSAGES_TABLE);
  if (!existingColumns.length) return;
  const desiredColumns = new Set<string>(CHAT_MESSAGE_COLUMNS);
  const existingColumnSet = new Set(existingColumns);
  const hasUnexpectedColumns = existingColumns.some(
    (column) => !desiredColumns.has(column),
  );
  const missingDesiredColumns = CHAT_MESSAGE_COLUMNS.some(
    (column) => !existingColumnSet.has(column),
  );
  if (!hasUnexpectedColumns && !missingDesiredColumns) return;

  const columnsToCopy = CHAT_MESSAGE_COLUMNS.filter((column) =>
    existingColumnSet.has(column),
  );
  if (!columnsToCopy.length) return;

  await Zotero.DB.queryAsync(`DROP INDEX IF EXISTS ${CHAT_MESSAGES_INDEX}`);
  await Zotero.DB.queryAsync(
    `DROP TABLE IF EXISTS ${TEMP_CHAT_MESSAGES_TABLE}`,
  );
  await Zotero.DB.queryAsync(
    `ALTER TABLE ${CHAT_MESSAGES_TABLE}
     RENAME TO ${TEMP_CHAT_MESSAGES_TABLE}`,
  );
  await Zotero.DB.queryAsync(CHAT_MESSAGES_CREATE_SQL);
  await Zotero.DB.queryAsync(
    `INSERT INTO ${CHAT_MESSAGES_TABLE}
      (${columnsToCopy.join(", ")})
     SELECT ${columnsToCopy.join(", ")}
     FROM ${TEMP_CHAT_MESSAGES_TABLE}`,
  );
  await Zotero.DB.queryAsync(
    `DROP TABLE IF EXISTS ${TEMP_CHAT_MESSAGES_TABLE}`,
  );
}

function normalizeConversationKey(conversationKey: number): number | null {
  if (!Number.isFinite(conversationKey)) return null;
  const normalized = Math.floor(conversationKey);
  return normalized > 0 ? normalized : null;
}

function normalizeLibraryID(libraryID: number): number | null {
  if (!Number.isFinite(libraryID)) return null;
  const normalized = Math.floor(libraryID);
  return normalized > 0 ? normalized : null;
}

function normalizePaperItemID(paperItemID: number): number | null {
  if (!Number.isFinite(paperItemID)) return null;
  const normalized = Math.floor(paperItemID);
  return normalized > 0 ? normalized : null;
}

function normalizeSessionVersion(sessionVersion: number): number | null {
  if (!Number.isFinite(sessionVersion)) return null;
  const normalized = Math.floor(sessionVersion);
  return normalized > 0 ? normalized : null;
}

function normalizeConversationTitleSeed(value: string): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.slice(0, 64);
}

function normalizeLimit(limit: number, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.floor(limit));
}

export async function initChatStore(): Promise<void> {
  await Zotero.DB.executeTransaction(async () => {
    await Zotero.DB.queryAsync(CHAT_MESSAGES_CREATE_SQL);
    await rebuildChatMessagesTableIfNeeded();

    await Zotero.DB.queryAsync(
      `CREATE INDEX IF NOT EXISTS ${CHAT_MESSAGES_INDEX}
       ON ${CHAT_MESSAGES_TABLE} (conversation_key, timestamp, id)`,
    );

    await Zotero.DB.queryAsync(
      `CREATE TABLE IF NOT EXISTS ${PAPER_CONVERSATIONS_TABLE} (
        conversation_key INTEGER PRIMARY KEY,
        library_id INTEGER NOT NULL,
        paper_item_id INTEGER NOT NULL,
        session_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        title TEXT,
        UNIQUE(paper_item_id, session_version)
      )`,
    );

    const paperColumns = (await Zotero.DB.queryAsync(
      `PRAGMA table_info(${PAPER_CONVERSATIONS_TABLE})`,
    )) as Array<{ name?: unknown }> | undefined;
    const hasPaperTitleColumn = Boolean(
      paperColumns?.some((column) => column?.name === "title"),
    );
    if (!hasPaperTitleColumn) {
      await Zotero.DB.queryAsync(
        `ALTER TABLE ${PAPER_CONVERSATIONS_TABLE}
         ADD COLUMN title TEXT`,
      );
    }

    await Zotero.DB.queryAsync(
      `CREATE INDEX IF NOT EXISTS ${PAPER_CONVERSATIONS_PAPER_INDEX}
       ON ${PAPER_CONVERSATIONS_TABLE} (paper_item_id, library_id, session_version, created_at DESC, conversation_key DESC)`,
    );

    await Zotero.DB.queryAsync(
      `CREATE INDEX IF NOT EXISTS ${PAPER_CONVERSATIONS_CONVERSATION_INDEX}
       ON ${PAPER_CONVERSATIONS_TABLE} (conversation_key, paper_item_id, session_version)`,
    );

    await initRememberedPaperConversationStore();
  });
}

export async function loadConversation(
  conversationKey: number,
  limit: number,
): Promise<StoredChatMessage[]> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return [];

  const normalizedLimit = normalizeLimit(limit, 200);
  const rows = (await Zotero.DB.queryAsync(
    `SELECT role,
            text,
            timestamp,
            selected_texts_json AS selectedTextsJson,
            selected_text_sources_json AS selectedTextSourcesJson,
            selected_text_paper_contexts_json AS selectedTextPaperContextsJson,
            paper_contexts_json AS paperContextsJson,
            full_text_paper_contexts_json AS fullTextPaperContextsJson,
            screenshot_images AS screenshotImages,
            attachments_json AS attachmentsJson,
            model_name AS modelName,
            model_entry_id AS modelEntryId,
            model_provider_label AS modelProviderLabel,
            webchat_run_state AS webchatRunState,
            webchat_completion_reason AS webchatCompletionReason,
            reasoning_summary AS reasoningSummary,
            reasoning_details AS reasoningDetails
     FROM ${CHAT_MESSAGES_TABLE}
     WHERE conversation_key = ?
     ORDER BY timestamp ASC, id ASC
     LIMIT ?`,
    [normalizedKey, normalizedLimit],
  )) as
    | Array<{
        role: unknown;
        text: unknown;
        timestamp: unknown;
        selectedTextsJson?: unknown;
        selectedTextSourcesJson?: unknown;
        selectedTextPaperContextsJson?: unknown;
        paperContextsJson?: unknown;
        fullTextPaperContextsJson?: unknown;
        screenshotImages?: unknown;
        attachmentsJson?: unknown;
        modelName?: unknown;
        modelEntryId?: unknown;
        modelProviderLabel?: unknown;
        webchatRunState?: unknown;
        webchatCompletionReason?: unknown;
        reasoningSummary?: unknown;
        reasoningDetails?: unknown;
      }>
    | undefined;

  if (!rows?.length) return [];

  const messages: StoredChatMessage[] = [];
  for (const row of rows) {
    const role =
      row.role === "assistant"
        ? "assistant"
        : row.role === "user"
          ? "user"
          : null;
    if (!role) continue;

    const timestamp = Number(row.timestamp);
    let selectedTexts: string[] | undefined;
    if (typeof row.selectedTextsJson === "string" && row.selectedTextsJson) {
      try {
        const parsed = JSON.parse(row.selectedTextsJson) as unknown;
        if (Array.isArray(parsed)) {
          const normalized = parsed.filter(
            (entry): entry is string =>
              typeof entry === "string" && Boolean(entry.trim()),
          );
          if (normalized.length) {
            selectedTexts = normalized;
          }
        }
      } catch (_err) {
        selectedTexts = undefined;
      }
    }
    let selectedTextSources: SelectedTextSource[] | undefined;
    if (
      typeof row.selectedTextSourcesJson === "string" &&
      row.selectedTextSourcesJson
    ) {
      try {
        const parsed = JSON.parse(row.selectedTextSourcesJson) as unknown;
        if (Array.isArray(parsed)) {
          selectedTextSources = parsed.map((entry) =>
            normalizeSelectedTextSource(entry),
          );
        }
      } catch (_err) {
        selectedTextSources = undefined;
      }
    }
    const normalizedTexts = selectedTexts?.length ? selectedTexts : [];
    let selectedTextPaperContexts: (PaperContextRef | undefined)[] | undefined;
    if (
      typeof row.selectedTextPaperContextsJson === "string" &&
      row.selectedTextPaperContextsJson
    ) {
      try {
        const parsed = JSON.parse(row.selectedTextPaperContextsJson) as unknown;
        const normalized = normalizeSelectedTextPaperContexts(
          parsed,
          normalizedTexts.length,
        );
        if (normalized.some((entry) => Boolean(entry))) {
          selectedTextPaperContexts = normalized;
        }
      } catch (_err) {
        selectedTextPaperContexts = undefined;
      }
    }
    let paperContexts: PaperContextRef[] | undefined;
    if (typeof row.paperContextsJson === "string" && row.paperContextsJson) {
      try {
        const parsed = JSON.parse(row.paperContextsJson) as unknown;
        const normalized = normalizePaperContextRefs(parsed);
        if (normalized.length) {
          paperContexts = normalized;
        }
      } catch (_err) {
        paperContexts = undefined;
      }
    }
    let fullTextPaperContexts: PaperContextRef[] | undefined;
    if (
      typeof row.fullTextPaperContextsJson === "string" &&
      row.fullTextPaperContextsJson
    ) {
      try {
        const parsed = JSON.parse(row.fullTextPaperContextsJson) as unknown;
        const normalized = normalizePaperContextRefs(parsed);
        if (normalized.length) {
          fullTextPaperContexts = normalized;
        }
      } catch (_err) {
        fullTextPaperContexts = undefined;
      }
    }
    let screenshotImages: string[] | undefined;
    if (typeof row.screenshotImages === "string" && row.screenshotImages) {
      try {
        const parsed = JSON.parse(row.screenshotImages) as unknown;
        if (Array.isArray(parsed)) {
          const normalized = parsed.filter(
            (entry): entry is string =>
              typeof entry === "string" && Boolean(entry.trim()),
          );
          if (normalized.length) {
            screenshotImages = normalized;
          }
        }
      } catch (_err) {
        screenshotImages = undefined;
      }
    }
    let attachments: StoredChatMessage["attachments"] | undefined;
    if (typeof row.attachmentsJson === "string" && row.attachmentsJson) {
      try {
        const parsed = JSON.parse(row.attachmentsJson) as unknown;
        if (Array.isArray(parsed)) {
          const normalized = parsed.reduce<
            NonNullable<StoredChatMessage["attachments"]>
          >((out, entry) => {
            if (!entry || typeof entry !== "object") return out;
            const typed = entry as Record<string, unknown>;
            const id =
              typeof typed.id === "string" && typed.id.trim()
                ? typed.id.trim()
                : null;
            const name =
              typeof typed.name === "string" && typed.name.trim()
                ? typed.name.trim()
                : null;
            const mimeType =
              typeof typed.mimeType === "string" && typed.mimeType.trim()
                ? typed.mimeType.trim()
                : "application/octet-stream";
            const sizeBytes = Number(typed.sizeBytes);
            const category = typed.category;
            const validCategory =
              category === "image" ||
              category === "pdf" ||
              category === "markdown" ||
              category === "code" ||
              category === "text" ||
              category === "file";
            if (!id || !name || !validCategory) return out;
            out.push({
              id,
              name,
              mimeType,
              sizeBytes: Number.isFinite(sizeBytes)
                ? Math.max(0, sizeBytes)
                : 0,
              category,
              imageDataUrl:
                typeof typed.imageDataUrl === "string" &&
                typed.imageDataUrl.trim()
                  ? typed.imageDataUrl
                  : undefined,
              textContent:
                typeof typed.textContent === "string" && typed.textContent
                  ? typed.textContent
                  : undefined,
              storedPath:
                typeof typed.storedPath === "string" && typed.storedPath.trim()
                  ? typed.storedPath.trim()
                  : undefined,
              contentHash:
                typeof typed.contentHash === "string" &&
                /^[a-f0-9]{64}$/i.test(typed.contentHash.trim())
                  ? typed.contentHash.trim().toLowerCase()
                  : undefined,
            });
            return out;
          }, []);
          if (normalized.length) {
            attachments = normalized;
          }
        }
      } catch (_err) {
        attachments = undefined;
      }
    }
    messages.push({
      role,
      text: typeof row.text === "string" ? row.text : "",
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      selectedTexts: normalizedTexts.length ? normalizedTexts : undefined,
      selectedTextSources: (() => {
        if (!normalizedTexts.length) return undefined;
        return normalizedTexts.map((_, index) =>
          normalizeSelectedTextSource(selectedTextSources?.[index]),
        );
      })(),
      selectedTextPaperContexts,
      paperContexts,
      fullTextPaperContexts,
      screenshotImages,
      attachments,
      modelName: typeof row.modelName === "string" ? row.modelName : undefined,
      modelEntryId:
        typeof row.modelEntryId === "string" ? row.modelEntryId : undefined,
      modelProviderLabel:
        typeof row.modelProviderLabel === "string"
          ? row.modelProviderLabel
          : undefined,
      webchatRunState:
        row.webchatRunState === "done" ||
        row.webchatRunState === "incomplete" ||
        row.webchatRunState === "error"
          ? row.webchatRunState
          : undefined,
      webchatCompletionReason:
        row.webchatCompletionReason === "settled" ||
        row.webchatCompletionReason === "forced_cancel" ||
        row.webchatCompletionReason === "timeout" ||
        row.webchatCompletionReason === "error"
          ? row.webchatCompletionReason
          : undefined,
      reasoningSummary:
        typeof row.reasoningSummary === "string"
          ? row.reasoningSummary
          : undefined,
      reasoningDetails:
        typeof row.reasoningDetails === "string"
          ? row.reasoningDetails
          : undefined,
    });
  }

  return messages;
}

export async function appendMessage(
  conversationKey: number,
  message: StoredChatMessage,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;

  const timestamp = Number(message.timestamp);
  const selectedTexts = Array.isArray(message.selectedTexts)
    ? message.selectedTexts
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const selectedTextSources = selectedTexts.map((_, index) =>
    normalizeSelectedTextSource(message.selectedTextSources?.[index]),
  );
  const selectedTextPaperContexts = normalizeSelectedTextPaperContexts(
    message.selectedTextPaperContexts,
    selectedTexts.length,
  );
  const paperContexts = normalizePaperContextRefs(message.paperContexts);
  const fullTextPaperContexts = normalizePaperContextRefs(
    message.fullTextPaperContexts,
  );
  const screenshotImages = Array.isArray(message.screenshotImages)
    ? message.screenshotImages.filter((entry) => Boolean(entry))
    : [];
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .filter(
          (entry) => entry && typeof entry.id === "string" && entry.id.trim(),
        )
        .map((entry) => ({
          ...entry,
          storedPath:
            typeof entry.storedPath === "string" && entry.storedPath.trim()
              ? entry.storedPath.trim()
              : undefined,
          contentHash:
            typeof entry.contentHash === "string" &&
            /^[a-f0-9]{64}$/i.test(entry.contentHash.trim())
              ? entry.contentHash.trim().toLowerCase()
              : undefined,
        }))
    : [];
  await Zotero.DB.queryAsync(
    `INSERT INTO ${CHAT_MESSAGES_TABLE}
      (conversation_key, role, text, timestamp, selected_texts_json, selected_text_sources_json, selected_text_paper_contexts_json, paper_contexts_json, full_text_paper_contexts_json, screenshot_images, attachments_json, model_name, model_entry_id, model_provider_label, webchat_run_state, webchat_completion_reason, reasoning_summary, reasoning_details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizedKey,
      message.role,
      message.text,
      Number.isFinite(timestamp) ? Math.floor(timestamp) : Date.now(),
      selectedTexts.length ? JSON.stringify(selectedTexts) : null,
      selectedTextSources.length ? JSON.stringify(selectedTextSources) : null,
      selectedTextPaperContexts.some((entry) => Boolean(entry))
        ? JSON.stringify(selectedTextPaperContexts)
        : null,
      paperContexts.length ? JSON.stringify(paperContexts) : null,
      fullTextPaperContexts.length
        ? JSON.stringify(fullTextPaperContexts)
        : null,
      screenshotImages.length ? JSON.stringify(screenshotImages) : null,
      attachments.length ? JSON.stringify(attachments) : null,
      message.modelName || null,
      message.modelEntryId || null,
      message.modelProviderLabel || null,
      message.webchatRunState || null,
      message.webchatCompletionReason || null,
      message.reasoningSummary || null,
      message.reasoningDetails || null,
    ],
  );
}

export async function updateLatestUserMessage(
  conversationKey: number,
  message: Pick<
    StoredChatMessage,
    | "text"
    | "timestamp"
    | "selectedTexts"
    | "selectedTextSources"
    | "selectedTextPaperContexts"
    | "paperContexts"
    | "fullTextPaperContexts"
    | "screenshotImages"
    | "attachments"
  >,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;

  const timestamp = Number(message.timestamp);
  const selectedTexts = Array.isArray(message.selectedTexts)
    ? message.selectedTexts
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const selectedTextSources = selectedTexts.map((_, index) =>
    normalizeSelectedTextSource(message.selectedTextSources?.[index]),
  );
  const selectedTextPaperContexts = normalizeSelectedTextPaperContexts(
    message.selectedTextPaperContexts,
    selectedTexts.length,
  );
  const paperContexts = normalizePaperContextRefs(message.paperContexts);
  const fullTextPaperContexts = normalizePaperContextRefs(
    message.fullTextPaperContexts,
  );
  const screenshotImages = Array.isArray(message.screenshotImages)
    ? message.screenshotImages.filter((entry) => Boolean(entry))
    : [];
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .filter(
          (entry) => entry && typeof entry.id === "string" && entry.id.trim(),
        )
        .map((entry) => ({
          ...entry,
          storedPath:
            typeof entry.storedPath === "string" && entry.storedPath.trim()
              ? entry.storedPath.trim()
              : undefined,
          contentHash:
            typeof entry.contentHash === "string" &&
            /^[a-f0-9]{64}$/i.test(entry.contentHash.trim())
              ? entry.contentHash.trim().toLowerCase()
              : undefined,
        }))
    : [];

  await Zotero.DB.queryAsync(
    `UPDATE ${CHAT_MESSAGES_TABLE}
     SET text = ?,
         timestamp = ?,
         selected_texts_json = ?,
         selected_text_sources_json = ?,
         selected_text_paper_contexts_json = ?,
         paper_contexts_json = ?,
         full_text_paper_contexts_json = ?,
         screenshot_images = ?,
         attachments_json = ?
     WHERE id = (
       SELECT id
       FROM ${CHAT_MESSAGES_TABLE}
       WHERE conversation_key = ? AND role = 'user'
       ORDER BY timestamp DESC, id DESC
       LIMIT 1
     )`,
    [
      message.text || "",
      Number.isFinite(timestamp) ? Math.floor(timestamp) : Date.now(),
      selectedTexts.length ? JSON.stringify(selectedTexts) : null,
      selectedTextSources.length ? JSON.stringify(selectedTextSources) : null,
      selectedTextPaperContexts.some((entry) => Boolean(entry))
        ? JSON.stringify(selectedTextPaperContexts)
        : null,
      paperContexts.length ? JSON.stringify(paperContexts) : null,
      fullTextPaperContexts.length
        ? JSON.stringify(fullTextPaperContexts)
        : null,
      screenshotImages.length ? JSON.stringify(screenshotImages) : null,
      attachments.length ? JSON.stringify(attachments) : null,
      normalizedKey,
    ],
  );
}

export async function updateLatestAssistantMessage(
  conversationKey: number,
  message: Pick<
    StoredChatMessage,
    | "text"
    | "timestamp"
    | "modelName"
    | "modelEntryId"
    | "modelProviderLabel"
    | "webchatRunState"
    | "webchatCompletionReason"
    | "reasoningSummary"
    | "reasoningDetails"
  >,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;

  const timestamp = Number(message.timestamp);
  await Zotero.DB.queryAsync(
    `UPDATE ${CHAT_MESSAGES_TABLE}
     SET text = ?,
         timestamp = ?,
         model_name = ?,
         model_entry_id = ?,
         model_provider_label = ?,
         webchat_run_state = ?,
         webchat_completion_reason = ?,
         reasoning_summary = ?,
         reasoning_details = ?
     WHERE id = (
       SELECT id
       FROM ${CHAT_MESSAGES_TABLE}
       WHERE conversation_key = ? AND role = 'assistant'
       ORDER BY timestamp DESC, id DESC
       LIMIT 1
     )`,
    [
      message.text || "",
      Number.isFinite(timestamp) ? Math.floor(timestamp) : Date.now(),
      message.modelName || null,
      message.modelEntryId || null,
      message.modelProviderLabel || null,
      message.webchatRunState || null,
      message.webchatCompletionReason || null,
      message.reasoningSummary || null,
      message.reasoningDetails || null,
      normalizedKey,
    ],
  );
}

export async function clearConversation(
  conversationKey: number,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;

  await Zotero.DB.queryAsync(
    `DELETE FROM ${CHAT_MESSAGES_TABLE}
     WHERE conversation_key = ?`,
    [normalizedKey],
  );
}

export async function deleteTurnMessages(
  conversationKey: number,
  userTimestamp: number,
  assistantTimestamp: number,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;
  const normalizedUserTimestamp = Number.isFinite(userTimestamp)
    ? Math.floor(userTimestamp)
    : 0;
  const normalizedAssistantTimestamp = Number.isFinite(assistantTimestamp)
    ? Math.floor(assistantTimestamp)
    : 0;
  if (normalizedUserTimestamp <= 0 || normalizedAssistantTimestamp <= 0) return;

  await Zotero.DB.executeTransaction(async () => {
    await Zotero.DB.queryAsync(
      `DELETE FROM ${CHAT_MESSAGES_TABLE}
       WHERE id = (
         SELECT id
         FROM ${CHAT_MESSAGES_TABLE}
         WHERE conversation_key = ?
           AND role = 'user'
           AND timestamp = ?
         ORDER BY id DESC
         LIMIT 1
       )`,
      [normalizedKey, normalizedUserTimestamp],
    );
    await Zotero.DB.queryAsync(
      `DELETE FROM ${CHAT_MESSAGES_TABLE}
       WHERE id = (
         SELECT id
         FROM ${CHAT_MESSAGES_TABLE}
         WHERE conversation_key = ?
           AND role = 'assistant'
           AND timestamp = ?
         ORDER BY id DESC
         LIMIT 1
       )`,
      [normalizedKey, normalizedAssistantTimestamp],
    );
  });
}

export async function pruneConversation(
  conversationKey: number,
  keep: number,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;

  const normalizedKeep = Number.isFinite(keep) ? Math.floor(keep) : 200;
  if (normalizedKeep <= 0) {
    await clearConversation(normalizedKey);
    return;
  }

  await Zotero.DB.queryAsync(
    `DELETE FROM ${CHAT_MESSAGES_TABLE}
     WHERE id IN (
       SELECT id
       FROM ${CHAT_MESSAGES_TABLE}
       WHERE conversation_key = ?
       ORDER BY timestamp DESC, id DESC
       LIMIT -1 OFFSET ?
     )`,
    [normalizedKey, normalizedKeep],
  );
}

type PaperConversationSummaryRow = {
  conversationKey?: unknown;
  libraryID?: unknown;
  paperItemID?: unknown;
  sessionVersion?: unknown;
  createdAt?: unknown;
  title?: unknown;
  lastActivityAt?: unknown;
  userTurnCount?: unknown;
};

function toPaperConversationSummary(
  row: PaperConversationSummaryRow,
): PaperConversationSummary | null {
  const conversationKey = normalizeConversationKey(Number(row.conversationKey));
  const libraryID = normalizeLibraryID(Number(row.libraryID));
  const paperItemID = normalizePaperItemID(Number(row.paperItemID));
  const sessionVersion = normalizeSessionVersion(Number(row.sessionVersion));
  const createdAt = Number(row.createdAt);
  const lastActivityAt = Number(row.lastActivityAt);
  const userTurnCount = Number(row.userTurnCount);
  if (
    !conversationKey ||
    !libraryID ||
    !paperItemID ||
    !sessionVersion ||
    !Number.isFinite(createdAt)
  ) {
    return null;
  }
  return {
    conversationKey,
    libraryID,
    paperItemID,
    sessionVersion,
    createdAt: Math.floor(createdAt),
    title:
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim()
        : undefined,
    lastActivityAt: Number.isFinite(lastActivityAt)
      ? Math.floor(lastActivityAt)
      : Math.floor(createdAt),
    userTurnCount: Number.isFinite(userTurnCount)
      ? Math.max(0, Math.floor(userTurnCount))
      : 0,
  };
}

async function resolveNextPaperConversationKey(): Promise<number> {
  const rows = (await Zotero.DB.queryAsync(
    `SELECT MAX(conversation_key) AS maxConversationKey
     FROM ${PAPER_CONVERSATIONS_TABLE}
     WHERE conversation_key >= ?`,
    [PAPER_CONVERSATION_KEY_BASE],
  )) as Array<{ maxConversationKey?: unknown }> | undefined;
  const maxConversationKey = Number(rows?.[0]?.maxConversationKey);
  const next = Number.isFinite(maxConversationKey)
    ? Math.max(PAPER_CONVERSATION_KEY_BASE, Math.floor(maxConversationKey) + 1)
    : PAPER_CONVERSATION_KEY_BASE;
  return next;
}

async function findLowestMissingPaperSessionVersion(
  paperItemID: number,
): Promise<number> {
  const rows = (await Zotero.DB.queryAsync(
    `SELECT session_version AS sessionVersion
     FROM ${PAPER_CONVERSATIONS_TABLE}
     WHERE paper_item_id = ?
     ORDER BY session_version ASC`,
    [paperItemID],
  )) as Array<{ sessionVersion?: unknown }> | undefined;
  const used = new Set<number>();
  for (const row of rows || []) {
    const normalized = normalizeSessionVersion(Number(row.sessionVersion));
    if (!normalized) continue;
    used.add(normalized);
  }
  let candidate = 1;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export async function ensurePaperV1Conversation(
  libraryID: number,
  paperItemID: number,
): Promise<PaperConversationSummary | null> {
  const normalizedLibraryID = normalizeLibraryID(libraryID);
  const normalizedPaperItemID = normalizePaperItemID(paperItemID);
  if (!normalizedLibraryID || !normalizedPaperItemID) return null;
  const createdAt = Date.now();
  await Zotero.DB.queryAsync(
    `INSERT OR IGNORE INTO ${PAPER_CONVERSATIONS_TABLE}
      (conversation_key, library_id, paper_item_id, session_version, created_at, title)
     VALUES (?, ?, ?, 1, ?, NULL)`,
    [
      normalizedPaperItemID,
      normalizedLibraryID,
      normalizedPaperItemID,
      createdAt,
    ],
  );
  return await getPaperConversation(normalizedPaperItemID);
}

export async function createPaperConversation(
  libraryID: number,
  paperItemID: number,
): Promise<PaperConversationSummary | null> {
  const normalizedLibraryID = normalizeLibraryID(libraryID);
  const normalizedPaperItemID = normalizePaperItemID(paperItemID);
  if (!normalizedLibraryID || !normalizedPaperItemID) return null;
  await ensurePaperV1Conversation(normalizedLibraryID, normalizedPaperItemID);
  return await Zotero.DB.executeTransaction(async () => {
    const nextVersion = await findLowestMissingPaperSessionVersion(
      normalizedPaperItemID,
    );
    const createdAt = Date.now();
    const nextConversationKey =
      nextVersion === 1
        ? normalizedPaperItemID
        : await resolveNextPaperConversationKey();
    await Zotero.DB.queryAsync(
      `INSERT INTO ${PAPER_CONVERSATIONS_TABLE}
        (conversation_key, library_id, paper_item_id, session_version, created_at, title)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [
        nextConversationKey,
        normalizedLibraryID,
        normalizedPaperItemID,
        nextVersion,
        createdAt,
      ],
    );
    return await getPaperConversation(nextConversationKey);
  });
}

export async function listPaperConversations(
  libraryID: number,
  paperItemID: number,
  limit: number,
  includeEmpty = true,
): Promise<PaperConversationSummary[]> {
  const normalizedLibraryID = normalizeLibraryID(libraryID);
  const normalizedPaperItemID = normalizePaperItemID(paperItemID);
  if (!normalizedLibraryID || !normalizedPaperItemID) return [];
  const normalizedLimit = normalizeLimit(limit, 50);

  const rows = (await Zotero.DB.queryAsync(
    `SELECT pc.conversation_key AS conversationKey,
            pc.library_id AS libraryID,
            pc.paper_item_id AS paperItemID,
            pc.session_version AS sessionVersion,
            pc.created_at AS createdAt,
            COALESCE(
              NULLIF(TRIM(pc.title), ''),
              (
                SELECT m0.text
                FROM ${CHAT_MESSAGES_TABLE} m0
                WHERE m0.conversation_key = pc.conversation_key
                  AND m0.role = 'user'
                ORDER BY m0.timestamp ASC, m0.id ASC
                LIMIT 1
              )
            ) AS title,
            COALESCE(MAX(m.timestamp), pc.created_at) AS lastActivityAt,
            SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS userTurnCount
     FROM ${PAPER_CONVERSATIONS_TABLE} pc
     LEFT JOIN ${CHAT_MESSAGES_TABLE} m
       ON m.conversation_key = pc.conversation_key
     WHERE pc.library_id = ?
       AND pc.paper_item_id = ?
     GROUP BY pc.conversation_key, pc.library_id, pc.paper_item_id, pc.session_version, pc.created_at, pc.title
     ${includeEmpty ? "" : "HAVING SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) > 0"}
     ORDER BY lastActivityAt DESC, pc.conversation_key DESC
     LIMIT ?`,
    [normalizedLibraryID, normalizedPaperItemID, normalizedLimit],
  )) as PaperConversationSummaryRow[] | undefined;

  if (!rows?.length) return [];
  const out: PaperConversationSummary[] = [];
  for (const row of rows) {
    const normalized = toPaperConversationSummary(row);
    if (!normalized) continue;
    out.push(normalized);
  }
  return out;
}

export async function getPaperConversation(
  conversationKey: number,
): Promise<PaperConversationSummary | null> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return null;
  const rows = (await Zotero.DB.queryAsync(
    `SELECT pc.conversation_key AS conversationKey,
            pc.library_id AS libraryID,
            pc.paper_item_id AS paperItemID,
            pc.session_version AS sessionVersion,
            pc.created_at AS createdAt,
            COALESCE(
              NULLIF(TRIM(pc.title), ''),
              (
                SELECT m0.text
                FROM ${CHAT_MESSAGES_TABLE} m0
                WHERE m0.conversation_key = pc.conversation_key
                  AND m0.role = 'user'
                ORDER BY m0.timestamp ASC, m0.id ASC
                LIMIT 1
              )
            ) AS title,
            COALESCE(MAX(m.timestamp), pc.created_at) AS lastActivityAt,
            SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS userTurnCount
     FROM ${PAPER_CONVERSATIONS_TABLE} pc
     LEFT JOIN ${CHAT_MESSAGES_TABLE} m
       ON m.conversation_key = pc.conversation_key
     WHERE pc.conversation_key = ?
     GROUP BY pc.conversation_key, pc.library_id, pc.paper_item_id, pc.session_version, pc.created_at, pc.title
     LIMIT 1`,
    [normalizedKey],
  )) as PaperConversationSummaryRow[] | undefined;
  if (!rows?.length) return null;
  return toPaperConversationSummary(rows[0]);
}

export async function deletePaperConversation(
  conversationKey: number,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;
  await Zotero.DB.queryAsync(
    `DELETE FROM ${PAPER_CONVERSATIONS_TABLE}
     WHERE conversation_key = ?`,
    [normalizedKey],
  );
}

export async function touchPaperConversationTitle(
  conversationKey: number,
  titleSeed: string,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;
  const title = normalizeConversationTitleSeed(titleSeed);
  if (!title) return;
  await Zotero.DB.queryAsync(
    `UPDATE ${PAPER_CONVERSATIONS_TABLE}
     SET title = ?
     WHERE conversation_key = ?
       AND (title IS NULL OR TRIM(title) = '')`,
    [title, normalizedKey],
  );
}

export async function setPaperConversationTitle(
  conversationKey: number,
  titleSeed: string,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;
  const title = normalizeConversationTitleSeed(titleSeed);
  if (!title) return;
  await Zotero.DB.queryAsync(
    `UPDATE ${PAPER_CONVERSATIONS_TABLE}
     SET title = ?
     WHERE conversation_key = ?`,
    [title, normalizedKey],
  );
}

export async function clearConversationTitle(
  conversationKey: number,
): Promise<void> {
  const normalizedKey = normalizeConversationKey(conversationKey);
  if (!normalizedKey) return;
  await Zotero.DB.queryAsync(
    `UPDATE ${PAPER_CONVERSATIONS_TABLE}
     SET title = NULL
     WHERE conversation_key = ?`,
    [normalizedKey],
  );
}
