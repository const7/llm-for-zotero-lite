import { assert } from "chai";
import {
  shouldNotifyConversationHistoryConsumers,
  shouldReloadConversationHistoryMenu,
} from "../src/modules/contextPanel/historyRefreshPolicy";

describe("historyRefreshPolicy", function () {
  it("reloads history entries only when the menu is visible or being opened", function () {
    assert.isFalse(
      shouldReloadConversationHistoryMenu("selection", false),
    );
    assert.isFalse(
      shouldReloadConversationHistoryMenu("mutation", false),
    );
    assert.isTrue(
      shouldReloadConversationHistoryMenu("mutation", true),
    );
    assert.isTrue(
      shouldReloadConversationHistoryMenu("menu-open", false),
    );
  });

  it("notifies external history consumers only for real history changes", function () {
    assert.isFalse(shouldNotifyConversationHistoryConsumers("selection"));
    assert.isTrue(shouldNotifyConversationHistoryConsumers("mutation"));
    assert.isTrue(shouldNotifyConversationHistoryConsumers("menu-open"));
  });
});
