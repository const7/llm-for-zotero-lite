import { assert } from "chai";
import {
  formatPageSelectionValue,
  isExplicitWholeDocumentRequest,
  parsePageSelectionText,
  parsePageSelectionValue,
} from "../src/agent/services/pdfPageService";

describe("PdfPageService helpers", function () {
  it("parses explicit page references from user text", function () {
    const parsed = parsePageSelectionText(
      "Please inspect pages 3-5 and page 9 of the PDF",
    );
    assert.deepEqual(parsed?.pageIndexes, [2, 3, 4, 8]);
    assert.equal(parsed?.displayValue, "p3-5, p9");
  });

  it("parses editable page selections from arrays and strings", function () {
    assert.deepEqual(parsePageSelectionValue([1, 3, 4])?.pageIndexes, [0, 2, 3]);
    assert.deepEqual(parsePageSelectionValue("p2-3")?.pageIndexes, [1, 2]);
    assert.equal(formatPageSelectionValue([0, 1, 4]), "p1-2, p5");
  });

  it("detects explicit whole-document requests", function () {
    assert.isTrue(
      isExplicitWholeDocumentRequest("Read the whole PDF before answering"),
    );
    assert.isFalse(
      isExplicitWholeDocumentRequest("Check page 2 of the paper"),
    );
  });
});
