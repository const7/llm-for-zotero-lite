import { assert } from "chai";
import { loadConversationHistoryScope } from "../src/modules/contextPanel/historyLoader";

describe("historyLoader", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: Record<string, unknown>;
  };
  const originalZotero = globalScope.Zotero;

  afterEach(function () {
    globalScope.Zotero = originalZotero;
  });

  it("loads normalized paper-chat history rows", async function () {
    globalScope.Zotero = {
      ...(originalZotero || {}),
      DB: {
        queryAsync: async (sql: string, params?: unknown[]) => {
          const normalizedParams = Array.isArray(params) ? params : [];
          if (
            sql.includes(
              "INSERT OR IGNORE INTO llm_for_zotero_paper_conversations",
            )
          ) {
            return [];
          }
          if (
            sql.includes("FROM llm_for_zotero_paper_conversations pc") &&
            sql.includes("WHERE pc.conversation_key = ?")
          ) {
            return [
              {
                conversationKey: 321,
                libraryID: normalizedParams[0] === 321 ? 3 : 0,
                paperItemID: 321,
                sessionVersion: 1,
                createdAt: 200,
                title: "",
                lastActivityAt: 200,
                userTurnCount: 0,
              },
            ];
          }
          if (
            sql.includes("FROM llm_for_zotero_paper_conversations pc") &&
            sql.includes("WHERE pc.library_id = ?")
          ) {
            return [
              {
                conversationKey: 321,
                libraryID: 3,
                paperItemID: 321,
                sessionVersion: 1,
                createdAt: 200,
                title: "Paper thread",
                lastActivityAt: 250,
                userTurnCount: 1,
              },
            ];
          }
          return [];
        },
      },
    };

    const rows = await loadConversationHistoryScope({
      libraryID: 3,
      paperItemID: 321,
      limit: 20,
    });

    assert.deepEqual(rows, [
      {
        mode: "paper",
        conversationKey: 321,
        title: "Paper thread",
        createdAt: 200,
        lastActivityAt: 250,
        userTurnCount: 1,
        isDraft: false,
        sessionVersion: 1,
        paperItemID: 321,
      },
    ]);
  });
});
