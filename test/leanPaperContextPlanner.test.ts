import { assert } from "chai";
import type { ChatMessage } from "../src/utils/llmClient";
import { estimateAvailableContextBudget } from "../src/utils/llmClient";
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
    itemId: paperContext.itemId,
    contextItemId: paperContext.contextItemId,
    title: paperContext.title,
    citationKey: paperContext.citationKey,
    chunkIndex: 0,
    chunkText: "Evidence chunk",
    estimatedTokens: 120,
    bm25Score: 0.8,
    embeddingScore: 0.7,
    hybridScore: 0.9,
    evidenceScore: 1,
    ...overrides,
  };
}

describe("leanPaperContextPlanner", function () {
  const item = { id: 1 } as Zotero.Item;
  const activePaper = createPaperContext();

  it("does not retrieve papers that are already included in full-text mode", async function () {
    let retrievalCalls = 0;
    let fullTextMaxTokens = 0;
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
          contextItem: { id: activePaper.contextItemId } as Zotero.Item,
        }),
        resolvePaperContextRefFromAttachment: () => activePaper,
        ensurePaperContextsCached: async () => {},
        getPdfContext: () => undefined,
        buildTruncatedFullPaperContext: (
          paperContext,
          _pdfContext,
          options,
        ) => {
          fullTextMaxTokens = options.maxTokens;
          return {
            text: `FULL:${paperContext.contextItemId}:${options.maxTokens}`,
          };
        },
        buildPaperRetrievalCandidates: async () => {
          retrievalCalls += 1;
          return [createCandidate(activePaper)];
        },
        renderEvidencePack: () => "EVIDENCE",
        resolveContextPlanMineruImages: async () => [],
      },
    );

    assert.equal(retrievalCalls, 0);
    assert.equal(plan.combinedContext, `FULL:101:${fullTextMaxTokens}`);
    assert.isAbove(fullTextMaxTokens, 0);
    assert.equal(
      plan.strategy,
      "paper-first-full" satisfies ContextAssemblyStrategy,
    );
    assert.isUndefined(plan.assistantInstruction);
    assert.deepEqual(plan.paperContexts, [activePaper]);
    assert.deepEqual(plan.fullTextPaperContexts, [activePaper]);
    assert.deepEqual(statuses[statuses.length - 1], {
      text: "Using full paper context (1)",
      kind: "sending",
    });
  });

  it("respects the effective context budget on the lean full-text path", async function () {
    let fullTextMaxTokens = 0;
    const images = ["data:image/png;base64,aaaa"];
    const systemPrompt = "Use a very careful style.";
    const reasoning = {
      provider: "openai" as const,
      level: "high" as const,
    };
    const advanced = {
      maxTokens: 1200,
      inputTokenCap: 6000,
    };

    await buildLeanPaperContextPlanForRequest(
      {
        item,
        question: "Summarize this paper",
        paperContexts: [],
        fullTextPaperContexts: [activePaper],
        recentPaperContexts: [],
        history: [],
        effectiveModel: "gpt-5",
        images,
        reasoning,
        advanced,
        systemPrompt,
        setStatusSafely: () => {},
      },
      {
        resolveContextSourceItem: () => ({
          contextItem: { id: activePaper.contextItemId } as Zotero.Item,
        }),
        resolvePaperContextRefFromAttachment: () => activePaper,
        ensurePaperContextsCached: async () => {},
        getPdfContext: () => undefined,
        buildTruncatedFullPaperContext: (
          _paperContext,
          _pdfContext,
          options,
        ) => {
          fullTextMaxTokens = options.maxTokens;
          return { text: "FULL" };
        },
        buildPaperRetrievalCandidates: async () => [],
        renderEvidencePack: () => "",
        resolveContextPlanMineruImages: async () => [],
      },
    );

    const budget = estimateAvailableContextBudget({
      model: "gpt-5",
      prompt: "Summarize this paper",
      history: [],
      images,
      reasoning,
      maxTokens: advanced.maxTokens,
      inputTokenCap: advanced.inputTokenCap,
      systemPrompt,
    });
    assert.equal(fullTextMaxTokens, budget.contextBudgetTokens);
    assert.isBelow(fullTextMaxTokens, 6000);
  });

  it("keeps follow-up retrieval query tied to the current user question", async function () {
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
        question:
          "Do you have access to the full paper, and how does it differ from the prior result?",
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

    assert.equal(
      retrievalQuestion,
      "Do you have access to the full paper, and how does it differ from the prior result?",
    );
    assert.equal(
      plan.strategy,
      "paper-followup-retrieval" satisfies ContextAssemblyStrategy,
    );
    assert.isString(plan.assistantInstruction);
    assert.include(
      plan.assistantInstruction || "",
      "If the user asks about access",
    );
    assert.equal(plan.combinedContext, "EVIDENCE:1:1");
    assert.deepEqual(plan.mineruImages, ["image://figure-1"]);
    assert.deepEqual(mineruArgs?.paperContexts, [retrievalPaper]);
    assert.deepEqual(mineruArgs?.fullTextPaperContexts, []);
  });

  it("carries recent paper context into follow-up retrieval when no papers are explicitly selected", async function () {
    const priorPaper = createPaperContext({
      itemId: 2,
      contextItemId: 202,
      title: "Prior paper",
    });
    const retrievalCalls: number[] = [];

    const plan = await buildLeanPaperContextPlanForRequest(
      {
        item,
        question: "How does that compare with the current paper?",
        paperContexts: [],
        fullTextPaperContexts: [],
        recentPaperContexts: [priorPaper],
        history: [
          {
            role: "assistant",
            content: "The prior paper used a different baseline.",
          } as ChatMessage,
        ],
        effectiveModel: "gpt-5",
        setStatusSafely: () => {},
      },
      {
        resolveContextSourceItem: () => ({
          contextItem: { id: activePaper.contextItemId } as Zotero.Item,
        }),
        resolvePaperContextRefFromAttachment: () => activePaper,
        ensurePaperContextsCached: async () => {},
        getPdfContext: () => undefined,
        buildTruncatedFullPaperContext: (paperContext) => ({
          text: `FULL:${paperContext.contextItemId}`,
        }),
        buildPaperRetrievalCandidates: async (paperContext) => {
          retrievalCalls.push(paperContext.contextItemId);
          return [createCandidate(paperContext)];
        },
        renderEvidencePack: ({ papers, candidates }) =>
          `EVIDENCE:${papers.map((paper) => paper.contextItemId).join(",")}:${candidates.length}`,
        resolveContextPlanMineruImages: async () => [],
      },
    );

    assert.deepEqual(retrievalCalls, [101, 202]);
    assert.deepEqual(plan.paperContexts, [activePaper, priorPaper]);
    assert.equal(plan.combinedContext, "EVIDENCE:101,202:2");
  });
});
