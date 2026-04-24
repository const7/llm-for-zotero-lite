import { assert } from "chai";
import { canEditUserPromptTurn } from "../src/modules/contextPanel/editability";

describe("contextPanel editability", function () {
  it("keeps completed assistant-backed user prompts editable", function () {
    const editable = canEditUserPromptTurn({
      isUser: true,
      hasItem: true,
      conversationIsIdle: true,
      assistantPair: {
        role: "assistant",
      },
    });

    assert.isTrue(editable);
  });

  it("rejects edit mode when the paired assistant turn is missing", function () {
    const editable = canEditUserPromptTurn({
      isUser: true,
      hasItem: true,
      conversationIsIdle: true,
      assistantPair: null,
    });

    assert.isFalse(editable);
  });

  it("rejects edit mode while the conversation is active", function () {
    const editable = canEditUserPromptTurn({
      isUser: true,
      hasItem: true,
      conversationIsIdle: false,
      assistantPair: {
        role: "assistant",
      },
    });

    assert.isFalse(editable);
  });
});
