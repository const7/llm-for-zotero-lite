import { assert } from "chai";
import {
  getSelectedTextContextEntries,
  setSelectedTextContextEntries,
  syncSelectedTextContextForSource,
} from "../src/modules/contextPanel/contextResolution";

describe("contextResolution note-edit sync", function () {
  const itemId = 777;

  afterEach(function () {
    setSelectedTextContextEntries(itemId, []);
  });

  it("adds and removes transient note-edit context without dropping manual contexts", function () {
    setSelectedTextContextEntries(itemId, [
      { text: "PDF snippet", source: "pdf", pageIndex: 1, pageLabel: "2" },
      { text: "Model snippet", source: "model" },
    ]);

    assert.isTrue(
      syncSelectedTextContextForSource(itemId, "Edit this sentence", "note-edit"),
    );
    assert.deepEqual(
      getSelectedTextContextEntries(itemId).map((entry) => ({
        text: entry.text,
        source: entry.source,
      })),
      [
        { text: "Edit this sentence", source: "note-edit" },
        { text: "PDF snippet", source: "pdf" },
        { text: "Model snippet", source: "model" },
      ],
    );

    assert.isTrue(syncSelectedTextContextForSource(itemId, "", "note-edit"));
    assert.deepEqual(
      getSelectedTextContextEntries(itemId).map((entry) => ({
        text: entry.text,
        source: entry.source,
      })),
      [
        { text: "PDF snippet", source: "pdf" },
        { text: "Model snippet", source: "model" },
      ],
    );
  });

  it("does not rewrite state when the note-edit focus is unchanged", function () {
    assert.isTrue(
      syncSelectedTextContextForSource(itemId, "Tighten this wording", "note-edit"),
    );
    assert.isFalse(
      syncSelectedTextContextForSource(itemId, "Tighten this wording", "note-edit"),
    );
  });
});
