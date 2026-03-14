import { assert } from "chai";
import {
  createSearchLiteratureReviewAction,
  resolveSearchLiteratureReview,
} from "../src/agent/reviewCards";
import type {
  AgentConfirmationResolution,
  AgentToolContext,
  AgentToolResult,
} from "../src/agent/types";

const baseContext: AgentToolContext = {
  request: {
    conversationKey: 9,
    mode: "agent",
    userText: "find related papers",
    activeItemId: 55,
  },
  item: {
    getDisplayTitle: () => "Climer et al. (2025)",
  } as never,
  currentAnswerText: "",
  modelName: "gpt-5.4",
};

describe("reviewCards note drafts", function () {
  it("adds a diff preview for metadata note drafts", function () {
    const result: AgentToolResult = {
      callId: "call-1",
      name: "search_literature_online",
      ok: true,
      content: {
        mode: "metadata",
        results: [
          {
            source: "Crossref",
            title: "Climer metadata",
            authors: ["Alice Example"],
            year: 2025,
            doi: "10.1000/example",
          },
        ],
      },
    };

    const action = createSearchLiteratureReviewAction(result, baseContext, {});
    assert.exists(action);
    assert.deepEqual(
      action?.fields.map((field) => field.type),
      ["review_table", "diff_preview", "textarea"],
    );
    const diffField = action?.fields[1] as Extract<
      NonNullable<typeof action>["fields"][number],
      { type: "diff_preview" }
    >;
    assert.equal(diffField.sourceFieldId, "noteContent");
    assert.deepEqual(diffField.visibleForActionIds, ["save_note"]);
  });

  it("adds a diff preview for paper-result note drafts", function () {
    const result: AgentToolResult = {
      callId: "call-1",
      name: "search_literature_online",
      ok: true,
      content: {
        mode: "recommendations",
        source: "OpenAlex",
        results: [
          {
            title: "Paper For Note",
            authors: ["Dana Example"],
            year: 2025,
            doi: "10.1000/note",
          },
        ],
      },
    };

    const action = createSearchLiteratureReviewAction(result, baseContext, {});
    assert.exists(action);
    assert.deepEqual(
      action?.fields.map((field) => field.type),
      ["paper_result_list", "diff_preview", "textarea", "text", "select", "text"],
    );
    const diffField = action?.fields[1] as Extract<
      NonNullable<typeof action>["fields"][number],
      { type: "diff_preview" }
    >;
    assert.equal(diffField.sourceFieldId, "noteContent");
    assert.deepEqual(diffField.visibleForActionIds, ["save_note"]);
  });

  it("normalizes reviewed note content before invoking save_note", function () {
    const result: AgentToolResult = {
      callId: "call-1",
      name: "search_literature_online",
      ok: true,
      content: {
        mode: "metadata",
        results: [
          {
            source: "Crossref",
            title: "Climer metadata",
            authors: ["Alice Example"],
            year: 2025,
            doi: "10.1000/example",
          },
        ],
      },
    };
    const resolution: AgentConfirmationResolution = {
      approved: true,
      actionId: "save_note",
      data: {
        noteContent: "<h1>Summary</h1><p><strong>Key point</strong></p>",
      },
    };

    const next = resolveSearchLiteratureReview(
      {},
      result,
      resolution,
      baseContext,
    );

    assert.equal(next.kind, "invoke_tool");
    if (next.kind !== "invoke_tool") return;
    const operations = (
      next.call.arguments as { operations?: Array<{ type?: string; content?: string }> }
    ).operations;
    assert.equal(operations?.[0]?.type, "save_note");
    assert.equal(operations?.[0]?.content, "# Summary\n\n**Key point**");
  });
});
