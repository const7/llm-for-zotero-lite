import { assert } from "chai";
import {
  PROGRESSIVE_CHAT_RENDER_BATCH_SIZE,
  PROGRESSIVE_CHAT_RENDER_WINDOW_SIZE,
  resolveChatRenderStartIndex,
  getNextBackfillStartIndex,
  shouldBackfillOlderChatMessages,
} from "../src/modules/contextPanel/chatRenderWindow";

describe("chatRenderWindow", function () {
  it("renders the full history for short conversations", function () {
    assert.equal(
      resolveChatRenderStartIndex({
        historyLength: PROGRESSIVE_CHAT_RENDER_WINDOW_SIZE,
        existingConversationKey: 0,
        conversationKey: 42,
        existingStartIndex: 0,
        hasExistingRenderedContent: false,
        scrollMode: "followBottom",
      }),
      0,
    );
  });

  it("starts from the recent tail when hydrating a long conversation at follow-bottom", function () {
    assert.equal(
      resolveChatRenderStartIndex({
        historyLength: 120,
        existingConversationKey: 0,
        conversationKey: 42,
        existingStartIndex: 0,
        hasExistingRenderedContent: false,
        scrollMode: "followBottom",
      }),
      120 - PROGRESSIVE_CHAT_RENDER_WINDOW_SIZE,
    );
  });

  it("does not use progressive hydration when restoring a manual scroll position", function () {
    assert.equal(
      resolveChatRenderStartIndex({
        historyLength: 120,
        existingConversationKey: 0,
        conversationKey: 42,
        existingStartIndex: 0,
        hasExistingRenderedContent: false,
        scrollMode: "manual",
      }),
      0,
    );
  });

  it("keeps an existing partial window for the same conversation", function () {
    assert.equal(
      resolveChatRenderStartIndex({
        historyLength: 120,
        existingConversationKey: 42,
        conversationKey: 42,
        existingStartIndex: 72,
        hasExistingRenderedContent: true,
        scrollMode: "followBottom",
      }),
      72,
    );
  });

  it("clamps an existing window start index when history shrinks", function () {
    assert.equal(
      resolveChatRenderStartIndex({
        historyLength: 10,
        existingConversationKey: 42,
        conversationKey: 42,
        existingStartIndex: 10,
        hasExistingRenderedContent: true,
        scrollMode: "followBottom",
      }),
      9,
    );
  });

  it("backfills older messages in fixed-size batches", function () {
    assert.equal(
      getNextBackfillStartIndex(60),
      Math.max(0, 60 - PROGRESSIVE_CHAT_RENDER_BATCH_SIZE),
    );
    assert.equal(getNextBackfillStartIndex(5), 0);
  });

  it("only requests older messages when the viewport reaches the top", function () {
    assert.isTrue(
      shouldBackfillOlderChatMessages({
        renderedStartIndex: 24,
        scrollTop: 0,
      }),
    );
    assert.isTrue(
      shouldBackfillOlderChatMessages({
        renderedStartIndex: 24,
        scrollTop: 8,
      }),
    );
    assert.isFalse(
      shouldBackfillOlderChatMessages({
        renderedStartIndex: 24,
        scrollTop: 40,
      }),
    );
    assert.isFalse(
      shouldBackfillOlderChatMessages({
        renderedStartIndex: 0,
        scrollTop: 0,
      }),
    );
  });
});
