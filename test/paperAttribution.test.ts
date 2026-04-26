import { assert } from "chai";
import {
  buildPaperQuoteCitationGuidance,
  formatPaperCitationLabel,
  formatPaperSourceLabel,
} from "../src/modules/contextPanel/paperAttribution";

describe("paperAttribution", function () {
  it("formats author-year citation labels using Zotero Creator field directly", function () {
    const label = formatPaperCitationLabel({
      itemId: 1,
      contextItemId: 2,
      title: "Paper",
      firstCreator: "Smith et al.",
      year: "2021",
    });
    assert.equal(label, "Smith et al., 2021");
  });

  it("keeps citationKey internal and user label readable", function () {
    const label = formatPaperCitationLabel({
      itemId: 1,
      contextItemId: 2,
      title: "Paper",
      firstCreator: "Smith et al.",
      year: "2021",
      citationKey: "smith2021alpha",
    });
    assert.equal(label, "Smith et al., 2021");
  });

  it("formats parenthetical source labels and quote guidance", function () {
    const paper = {
      itemId: 1,
      contextItemId: 2,
      title: "Paper",
      firstCreator: "Smith et al.",
      year: "2021",
    };
    assert.equal(formatPaperSourceLabel(paper), "(Smith et al., 2021)");
    assert.include(
      buildPaperQuoteCitationGuidance(paper).join("\n"),
      "(Smith et al., 2021)",
    );
  });
});
