import { assert } from "chai";
import {
  getRememberedPaperConversationKey,
  initRememberedPaperConversationStore,
  removeRememberedPaperConversationKey,
  resetRememberedPaperConversationStoreForTests,
  setRememberedPaperConversationKey,
} from "../src/utils/paperConversationSessionStore";

describe("paperConversationSessionStore", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: Record<string, unknown>;
    ztoolkit?: { log?: (...args: unknown[]) => void };
  };
  const originalZotero = globalScope.Zotero;
  const originalZtoolkit = globalScope.ztoolkit;

  afterEach(function () {
    globalScope.Zotero = originalZotero;
    globalScope.ztoolkit = originalZtoolkit;
    resetRememberedPaperConversationStoreForTests();
  });

  it("migrates the legacy prefs map into sqlite-backed state", async function () {
    const prefWrites: Array<{ key: string; value: unknown; global?: boolean }> =
      [];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    globalScope.ztoolkit = {
      log: () => undefined,
    };
    globalScope.Zotero = {
      Prefs: {
        get: (key: string) =>
          key.endsWith(".lastUsedPaperConversationMap")
            ? JSON.stringify({ "7:42": 4207, "7:43": "invalid", nope: 9 })
            : "",
        set: (key: string, value: unknown, global?: boolean) => {
          prefWrites.push({ key, value, global });
        },
      },
      DB: {
        executeTransaction: async (fn: () => Promise<void>) => {
          await fn();
        },
        queryAsync: async (sql: string, params?: unknown[]) => {
          const normalizedParams = Array.isArray(params) ? params : [];
          queries.push({ sql, params: normalizedParams });
          if (sql.startsWith("SELECT library_id AS libraryID")) {
            return [
              {
                libraryID: 7,
                paperItemID: 42,
                conversationKey: 4207,
              },
            ];
          }
          return [];
        },
      },
    };

    await initRememberedPaperConversationStore();

    assert.equal(getRememberedPaperConversationKey(7, 42), 4207);
    assert.isNull(getRememberedPaperConversationKey(7, 43));
    assert.isTrue(
      queries.some((entry) =>
        entry.sql.includes(
          "CREATE TABLE IF NOT EXISTS llm_for_zotero_paper_conversation_state",
        ),
      ),
    );
    assert.isTrue(
      queries.some(
        (entry) =>
          entry.sql.includes(
            "INSERT INTO llm_for_zotero_paper_conversation_state",
          ) &&
          entry.params[0] === 7 &&
          entry.params[1] === 42 &&
          entry.params[2] === 4207,
      ),
    );
    assert.deepInclude(prefWrites, {
      key: "extensions.zotero.llmforzoterolite.lastUsedPaperConversationMap",
      value: "",
      global: true,
    });
  });

  it("updates cache immediately and skips duplicate writes", async function () {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    globalScope.ztoolkit = {
      log: () => undefined,
    };
    globalScope.Zotero = {
      Prefs: {
        get: () => "",
        set: () => undefined,
      },
      DB: {
        executeTransaction: async (fn: () => Promise<void>) => {
          await fn();
        },
        queryAsync: async (sql: string, params?: unknown[]) => {
          const normalizedParams = Array.isArray(params) ? params : [];
          queries.push({ sql, params: normalizedParams });
          if (sql.startsWith("SELECT library_id AS libraryID")) {
            return [];
          }
          return [];
        },
      },
    };

    await initRememberedPaperConversationStore();

    setRememberedPaperConversationKey(5, 9, 5001);
    assert.equal(getRememberedPaperConversationKey(5, 9), 5001);
    await Promise.resolve();
    const insertCountAfterFirstWrite = queries.filter((entry) =>
      entry.sql.includes("INSERT INTO llm_for_zotero_paper_conversation_state"),
    ).length;

    setRememberedPaperConversationKey(5, 9, 5001);
    await Promise.resolve();
    const insertCountAfterSecondWrite = queries.filter((entry) =>
      entry.sql.includes("INSERT INTO llm_for_zotero_paper_conversation_state"),
    ).length;

    assert.equal(insertCountAfterFirstWrite, 1);
    assert.equal(insertCountAfterSecondWrite, 1);

    removeRememberedPaperConversationKey(5, 9);
    assert.isNull(getRememberedPaperConversationKey(5, 9));
    await Promise.resolve();
    assert.isTrue(
      queries.some(
        (entry) =>
          entry.sql.includes(
            "DELETE FROM llm_for_zotero_paper_conversation_state",
          ) &&
          entry.params[0] === 5 &&
          entry.params[1] === 9,
      ),
    );
  });
});
