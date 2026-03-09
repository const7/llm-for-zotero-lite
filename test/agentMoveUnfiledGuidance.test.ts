import { assert } from "chai";
import { buildAgentInitialMessages } from "../src/agent/model/messageBuilder";
import { createMoveUnfiledPapersToCollectionTool } from "../src/agent/tools/write/moveUnfiledPapersToCollection";

describe("move_unfiled_papers_to_collection guidance", function () {
  it("adds direct write-tool guidance for unfiled move requests", function () {
    const tool = createMoveUnfiledPapersToCollectionTool({
      resolveLibraryID: () => 1,
      listCollectionSummaries: () => [],
      listUnfiledPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      getPaperTargetsByItemIds: () => [],
      getCollectionSummary: () => null,
      moveUnfiledItemsToCollections: async () => ({
        selectedCount: 0,
        movedCount: 0,
        skippedCount: 0,
        collections: [],
        items: [],
      }),
      moveUnfiledItemsToCollection: async () => ({
        selectedCount: 0,
        movedCount: 0,
        skippedCount: 0,
        collection: {
          collectionId: 1,
          name: "Example",
          libraryID: 1,
        },
        items: [],
      }),
    } as never);
    const messages = buildAgentInitialMessages(
      {
        conversationKey: 1,
        mode: "agent",
        userText: "Please help me move unfiled papers into collections",
      },
      [tool],
    );
    assert.equal(messages[0]?.role, "system");
    const systemText =
      typeof messages[0]?.content === "string" ? messages[0].content : "";
    assert.include(systemText, "call move_unfiled_papers_to_collection");
    assert.include(systemText, "per-paper assignments");
    assert.include(systemText, "one paper per row");
    assert.include(
      systemText,
      "call that write tool directly instead of asking a follow-up chat question",
    );
    assert.include(
      systemText,
      "call the relevant write tool next instead of stopping with a chat summary",
    );
  });
});
