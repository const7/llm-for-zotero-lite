import { assert } from "chai";
import { parseAtSearchToken } from "../src/modules/contextPanel/paperSearch";

describe("paperSearch @ token parsing", function () {
  it("keeps a single-word @ token active before whitespace", function () {
    const input = "@attention is all you need";
    const token = parseAtSearchToken(input, "@attention".length);

    assert.deepEqual(token, {
      query: "attention",
      tokenStart: 0,
      caretEnd: "@attention".length,
    });
  });

  it("dismisses the @ token after typing whitespace", function () {
    const input = "@attention is all you need";
    const token = parseAtSearchToken(input, input.length);

    assert.isNull(token);
  });

  it("finds the most recent valid @ token in surrounding text", function () {
    const input = "Please compare @transformer 2017 vaswani";
    const token = parseAtSearchToken(
      input,
      input.indexOf(" ", input.indexOf("@transformer")) >= 0
        ? input.indexOf(" ", input.indexOf("@transformer"))
        : input.length,
    );

    assert.isNotNull(token);
    assert.equal(token?.query, "transformer");
    assert.equal(token?.tokenStart, input.indexOf("@transformer"));
  });

  it("ignores @ signs that are not preceded by whitespace or start-of-string", function () {
    const input = "email user@example.com";
    const token = parseAtSearchToken(input, input.length);

    assert.isNull(token);
  });

  it("returns null when the caret is before the @ token", function () {
    const input = "prefix @retrieval augmented generation";
    const token = parseAtSearchToken(input, 4);

    assert.isNull(token);
  });
});
