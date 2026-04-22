import { assert } from "chai";
import {
  buildChatMessageDomKey,
  countReusableChatMessagePrefix,
  type ChatRenderedMessageState,
} from "../src/modules/contextPanel/chatRenderReconciler";

describe("chatRenderReconciler", function () {
  it("builds stable DOM keys from index, role, and timestamp", function () {
    assert.equal(
      buildChatMessageDomKey(3, { role: "assistant", timestamp: 1234.9 }),
      "3:assistant:1234",
    );
  });

  it("reuses the unchanged prefix when only the latest message rerenders", function () {
    const previous: ChatRenderedMessageState[] = [
      { domKey: "0:user:1", renderKey: "a" },
      { domKey: "1:assistant:2", renderKey: "b" },
      { domKey: "2:user:3", renderKey: "c" },
      { domKey: "3:assistant:4", renderKey: "d" },
    ];
    const next: ChatRenderedMessageState[] = [
      { domKey: "0:user:1", renderKey: "a" },
      { domKey: "1:assistant:2", renderKey: "b" },
      { domKey: "2:user:3", renderKey: "c" },
      { domKey: "3:assistant:4", renderKey: "d2" },
    ];

    assert.equal(countReusableChatMessagePrefix(previous, next), 3);
  });

  it("stops reusing rows once message identity changes", function () {
    const previous: ChatRenderedMessageState[] = [
      { domKey: "0:user:1", renderKey: "a" },
      { domKey: "1:assistant:2", renderKey: "b" },
      { domKey: "2:user:3", renderKey: "c" },
    ];
    const next: ChatRenderedMessageState[] = [
      { domKey: "0:user:1", renderKey: "a" },
      { domKey: "1:user:9", renderKey: "x" },
      { domKey: "2:assistant:10", renderKey: "y" },
    ];

    assert.equal(countReusableChatMessagePrefix(previous, next), 1);
  });
});
