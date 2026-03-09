import { assert } from "chai";
import { createComparePapersStructuredTool } from "../src/agent/tools/read/comparePapersStructured";
import type { AgentToolContext } from "../src/agent/types";

describe("compare_papers_structured tool", function () {
  const paperOne = {
    itemId: 101,
    contextItemId: 1001,
    title: "Paper One",
    firstCreator: "Alice Example",
    year: "2021",
  };
  const paperTwo = {
    itemId: 102,
    contextItemId: 1002,
    title: "Paper Two",
    firstCreator: "Bob Example",
    year: "2022",
  };

  const baseContext: AgentToolContext = {
    request: {
      conversationKey: 1,
      mode: "agent",
      userText: "Compare the selected papers",
      selectedPaperContexts: [paperOne],
      pinnedPaperContexts: [paperTwo],
      activeItemId: 999,
    },
    item: null,
    currentAnswerText: "",
    modelName: "gpt-5.4",
  };

  function makeTool() {
    return createComparePapersStructuredTool(
      {
        getFrontMatterExcerpt: async ({ paperContext }: { paperContext: typeof paperOne }) => ({
          text:
            paperContext.itemId === 101
              ? "Paper One objective is to explain the task. This paper uses a graph method."
              : "Paper Two objective is to benchmark the task. This paper uses a retrieval method.",
          chunkIndexes: [0],
          totalChunks: 4,
          paperContext,
        }),
        getPaperContextForItem: (item: { id?: number } | null | undefined) =>
          item
            ? ({
                itemId: 103,
                contextItemId: 1003,
                title: "Active Paper",
                firstCreator: "Cara Example",
                year: "2023",
              } as never)
            : null,
      } as never,
      {
        retrieveEvidence: async (params: {
          papers: Array<typeof paperOne>;
          question: string;
        }) => {
          const paper = params.papers[0];
          const q = params.question.toLowerCase();
          let text = "";
          if (q.includes("limitations")) {
            text =
              paper.itemId === 101
                ? `${paper.title} limitation is the small sample size.`
                : "";
          } else if (q.includes("research question")) {
            text = `${paper.title} objective is to explain the benchmark task.`;
          } else if (q.includes("main claim")) {
            text =
              paper.itemId === 102
                ? ""
                : `${paper.title} we show strong gains over the baseline.`;
          } else if (q.includes("method")) {
            text = `${paper.title} method uses a transformer model.`;
          } else if (q.includes("dataset")) {
            text = `${paper.title} dataset uses public benchmark samples.`;
          } else if (q.includes("results")) {
            text = `${paper.title} results improve accuracy by five points.`;
          }
          if (!text) return [];
          return [
            {
              paperContext: paper,
              chunkIndex: 0,
              sectionLabel: "Abstract",
              chunkKind: "abstract",
              sourceLabel: paper.title,
              text,
              score: 0.9,
            },
          ];
        },
      } as never,
      {
        getItem: (itemId?: number) => (itemId ? ({ id: itemId } as never) : null),
        resolveMetadataItem: ({ item }: { item?: { id?: number } | null }) =>
          item ? ({ id: item.id } as never) : null,
      } as never,
    );
  }

  it("preserves explicit order and builds the fixed row set", async function () {
    const tool = makeTool();
    const validated = tool.validate({
      paperContexts: [paperTwo, paperOne],
      question: "Compare methods and results",
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, baseContext);
    const normalized = result as {
      papers: Array<{ itemId: number }>;
      rows: Array<{
        id: string;
        cells: Array<{ status: string; summary: string }>;
      }>;
      crossPaperSummary: { openQuestions: string[] };
    };
    assert.deepEqual(
      normalized.papers.map((entry) => entry.itemId),
      [102, 101],
    );
    assert.deepEqual(
      normalized.rows.map((row) => row.id),
      [
        "research_question",
        "main_claim",
        "method",
        "dataset_or_materials",
        "results",
        "limitations",
      ],
    );
    assert.equal(normalized.rows[1]?.cells[0]?.status, "fallback");
    assert.equal(normalized.rows[5]?.cells[0]?.status, "empty");
    assert.isAtLeast(normalized.crossPaperSummary.openQuestions.length, 1);
  });

  it("uses selected, then pinned, then active paper when paperContexts are omitted", async function () {
    const tool = makeTool();
    const result = await tool.execute({}, baseContext);
    const normalized = result as {
      papers: Array<{ itemId: number }>;
    };
    assert.deepEqual(
      normalized.papers.map((entry) => entry.itemId),
      [101, 102, 103],
    );
  });

  it("rejects requests with fewer than two papers", async function () {
    const tool = makeTool();
    const localContext: AgentToolContext = {
      ...baseContext,
      request: {
        ...baseContext.request,
        selectedPaperContexts: [paperOne],
        pinnedPaperContexts: [],
        activeItemId: undefined,
      },
    };

    try {
      await tool.execute({}, localContext);
      assert.fail("Expected compare_papers_structured to throw");
    } catch (error) {
      assert.include(
        error instanceof Error ? error.message : String(error),
        "at least 2 papers",
      );
    }
  });
});
