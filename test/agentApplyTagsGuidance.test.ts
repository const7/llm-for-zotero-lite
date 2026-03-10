import { assert } from "chai";
import { buildAgentInitialMessages } from "../src/agent/model/messageBuilder";
import { createApplyTagsTool } from "../src/agent/tools/write/applyTags";

describe("apply_tags guidance", function () {
  it("adds direct write-tool guidance for broad tagging requests", function () {
    const tool = createApplyTagsTool({
      resolveLibraryID: () => 1,
      listUntaggedPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      getPaperTargetsByItemIds: () => [],
      applyTagAssignments: async () => ({
        selectedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        items: [],
      }),
      applyTagsToItems: async () => ({
        selectedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        items: [],
      }),
    } as never);
    const messages = buildAgentInitialMessages(
      {
        conversationKey: 1,
        mode: "agent",
        userText: "Can you help me add tags to papers?",
      },
      [tool],
    );
    assert.equal(messages[0]?.role, "system");
    const systemText =
      typeof messages[0]?.content === "string" ? messages[0].content : "";
    assert.include(systemText, "use apply_tags as the write tool");
    assert.include(systemText, "list_untagged_papers");
    assert.include(systemText, "per-paper tag assignments");
    assert.include(systemText, "one paper per row");
    assert.include(
      systemText,
      "call the relevant write tool next instead of stopping with a chat summary",
    );
  });
});
