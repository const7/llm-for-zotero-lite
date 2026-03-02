import { assert } from "chai";
import {
  buildPaperQuoteCitationGuidance,
  formatOpenChatTextContextLabel,
  formatPaperCitationLabel,
  formatPaperSourceLabel,
} from "../src/modules/contextPanel/paperAttribution";

describe("paperAttribution", function () {
  it("formats author-year citation labels", function () {
    const label = formatPaperCitationLabel({
      itemId: 1,
      contextItemId: 2,
      title: "Paper",
      firstCreator: "Alice Smith",
      year: "2021",
    });
    assert.equal(label, "Smith et al., 2021");
  });

  it("appends citationKey to disambiguate same-author same-year labels", function () {
    const label = formatPaperCitationLabel({
      itemId: 1,
      contextItemId: 2,
      title: "Paper",
      firstCreator: "Alice Smith",
      year: "2021",
      citationKey: "smith2021alpha",
    });
    assert.equal(label, "Smith et al., 2021 [smith2021alpha]");
  });

  it("formats parenthetical source labels and quote guidance", function () {
    const paper = {
      itemId: 1,
      contextItemId: 2,
      title: "Paper",
      firstCreator: "Alice Smith",
      year: "2021",
    };
    assert.equal(formatPaperSourceLabel(paper), "(Smith et al., 2021)");
    assert.include(
      buildPaperQuoteCitationGuidance(paper).join("\n"),
      "(Smith et al., 2021)",
    );
  });

  it("falls back deterministically when metadata is missing", function () {
    const label = formatOpenChatTextContextLabel({
      itemId: 42,
      contextItemId: 99,
      title: "Untitled",
    });
    assert.equal(label, "Paper 42 - Text Context");
  });
});
