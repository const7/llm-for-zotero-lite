import { assert } from "chai";
import type { ChatMessage } from "../src/utils/llmClient";
import type {
  ContextAssemblyStrategy,
  PaperContextCandidate,
  PaperContextRef,
} from "../src/modules/contextPanel/types";
import { buildLeanPaperContextPlanForRequest } from "../src/modules/contextPanel/leanPaperContextPlanner";

function createPaperContext(
  overrides: Partial<PaperContextRef> = {},
): PaperContextRef {
  return {
    itemId: 1,
    contextItemId: 101,
    title: "Current paper",
    attachmentTitle: "Current paper.pdf",
    citationKey: "Smith2024",
    ...overrides,
  };
}

function createCandidate(
  paperContext: PaperContextRef,
  overrides: Partial<PaperContextCandidate> = {},
): PaperContextCandidate {
  return {
    paperKey: `${paperContext.itemId}:${paperContext.contextItemId}`,
    paper: paperContext,
    chunkIndex: 0,
    text: "Evidence chunk",
    score: 1,
    sectionTitle: "Methods",
    pageLabel: "1",
    ...overrides,
  } as PaperContextCandidate;
}

describe("leanPaperContextPlanner", function () {
  const item = { id: 1 } as Zotero.Item;
  const activePaper = createPaperContext();

  it("does not retrieve papers that are already included in full-text mode", async function () {
    let retrievalCalls = 0;
    const statuses: Array<{ text: string; kind: string }> = [];

    const plan = await buildLeanPaperContextPlanForRequest(
      {
        item,
        question: "Summarize this paper",
        paperContexts: [],
        fullTextPaperContexts: [activePaper],
        recentPaperContexts: [],
        history: [],
        effectiveModel: "gpt-5",
        setStatusSafely: (text, kind) => {
          statuses.push({ text, kind });
        },
      },
      {
        resolveContextSourceItem: () => ({
          statusText: "Loading paper context",
          contextItem: { id: activePaper.contextItemId } as Zotero.Item,
        }),
        resolvePaperContextRefFromAttachment: () => activePaper,
        ensurePaperContextsCached: async () => {},
        getPdfContext: () => undefined,
        buildTruncatedFullPaperContext: (paperContext, _pdfContext, options) => ({
          text: `FULL:${paperContext.contextItemId}:${options.maxTokens}`,
        }),
        buildPaperRetrievalCandidates: async () => {
          retrievalCalls += 1;
          return [createCandidate(activePaper)];
        },
        renderEvidencePack: () => "EVIDENCE",
        resolveContextPlanMineruImages: async () => [],
      },
    );

    assert.equal(retrievalCalls, 0);
    assert.equal(plan.combinedContext, "FULL:101:7000");
    assert.equal(plan.strategy, "paper-first-full" satisfies ContextAssemblyStrategy);
    assert.isUndefined(plan.assistantInstruction);
    assert.deepEqual(plan.paperContexts, [activePaper]);
    assert.deepEqual(plan.fullTextPaperContexts, [activePaper]);
    assert.deepEqual(statuses[statuses.length - 1], {
      text: "Using full paper context (1)",
      kind: "sending",
    });
  });

  it("uses history-enriched retrieval for follow-up turns", async function () {
    const retrievalPaper = createPaperContext({
      itemId: 2,
      contextItemId: 202,
      title: "Related paper",
    });
    let retrievalQuestion = "";
    let mineruArgs:
      | {
          contextText: string;
          effectiveModel: string;
          activeContextItemId?: number | null;
          paperContexts: PaperContextRef[];
          fullTextPaperContexts: PaperContextRef[];
        }
      | undefined;

    const plan = await buildLeanPaperContextPlanForRequest(
      {
        item,
        question: "Do you have access to the full paper, and how does it differ from the prior result?",
        paperContexts: [retrievalPaper],
        fullTextPaperContexts: [],
        recentPaperContexts: [retrievalPaper],
        history: [
          {
            role: "assistant",
            content: "The prior answer focused on the baseline method.",
          } as ChatMessage,
        ],
        effectiveModel: "gpt-5",
        setStatusSafely: () => {},
      },
      {
        resolveContextSourceItem: () => ({
          statusText: "Loading paper context",
          contextItem: null,
        }),
        resolvePaperContextRefFromAttachment: () => null,
        ensurePaperContextsCached: async () => {},
        getPdfContext: () => undefined,
        buildTruncatedFullPaperContext: (paperContext) => ({
          text: `FULL:${paperContext.contextItemId}`,
        }),
        buildPaperRetrievalCandidates: async (
          _paperContext,
          _pdfContext,
          question,
        ) => {
          retrievalQuestion = question;
          return [createCandidate(retrievalPaper)];
        },
        renderEvidencePack: ({ papers, candidates }) =>
          `EVIDENCE:${papers.length}:${candidates.length}`,
        resolveContextPlanMineruImages: async (args) => {
          mineruArgs = args;
          return ["image://figure-1"];
        },
      },
    );

    assert.include(
      retrievalQuestion,
      "[Prior answer context: The prior answer focused on the baseline method.]",
    );
    assert.equal(
      plan.strategy,
      "paper-followup-retrieval" satisfies ContextAssemblyStrategy,
    );
    assert.isString(plan.assistantInstruction);
    assert.include(plan.assistantInstruction || "", "If the user asks about access");
    assert.equal(plan.combinedContext, "EVIDENCE:1:1");
    assert.deepEqual(plan.mineruImages, ["image://figure-1"]);
    assert.deepEqual(mineruArgs?.paperContexts, [retrievalPaper]);
    assert.deepEqual(mineruArgs?.fullTextPaperContexts, []);
  });
});
