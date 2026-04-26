import {
  estimateAvailableContextBudget,
  type ChatMessage,
  type ReasoningConfig,
} from "../../utils/llmClient";
import { estimateTextTokens } from "../../utils/modelInputCap";
import { buildPaperKey } from "./pdfContext";
import { sanitizeText } from "./textUtils";
import type {
  AdvancedModelParams,
  ContextAssemblyStrategy,
  PaperContextCandidate,
  PaperContextRef,
  PdfContext,
} from "./types";

type StatusKind = "ready" | "sending" | "warning" | "error";

type LeanPaperContextPlanParams = {
  item: Zotero.Item;
  question: string;
  paperContexts: PaperContextRef[];
  fullTextPaperContexts: PaperContextRef[];
  recentPaperContexts: PaperContextRef[];
  history: ChatMessage[];
  effectiveModel: string;
  images?: string[];
  reasoning?: ReasoningConfig;
  advanced?: AdvancedModelParams;
  systemPrompt?: string;
  pdfModePaperKeys?: Set<string>;
  pdfUploadSystemMessages?: string[];
  signal?: AbortSignal;
  setStatusSafely: (text: string, kind: StatusKind) => void;
};

type LeanPaperContextPlanDeps = {
  resolveContextSourceItem: (item: Zotero.Item) => {
    contextItem: Zotero.Item | null;
  };
  resolvePaperContextRefFromAttachment: (
    item: Zotero.Item | null | undefined,
  ) => PaperContextRef | null;
  ensurePaperContextsCached: (
    paperContexts: PaperContextRef[],
    signal?: AbortSignal,
  ) => Promise<void>;
  getPdfContext: (contextItemId: number) => PdfContext | undefined;
  buildTruncatedFullPaperContext: (
    paperContext: PaperContextRef,
    pdfContext: PdfContext | undefined,
    options: { maxTokens: number },
  ) => { text: string };
  buildPaperRetrievalCandidates: (
    paperContext: PaperContextRef,
    pdfContext: PdfContext | undefined,
    question: string,
    options: { topK: number; mode: "general" },
  ) => Promise<PaperContextCandidate[]>;
  renderEvidencePack: (params: {
    papers: PaperContextRef[];
    candidates: PaperContextCandidate[];
  }) => string;
  resolveContextPlanMineruImages: (params: {
    contextText: string;
    effectiveModel: string;
    activeContextItemId?: number | null;
    paperContexts: PaperContextRef[];
    fullTextPaperContexts: PaperContextRef[];
  }) => Promise<string[]>;
};

type LeanPaperContextPlan = {
  combinedContext: string;
  strategy: ContextAssemblyStrategy;
  assistantInstruction?: string;
  paperContexts: PaperContextRef[];
  fullTextPaperContexts: PaperContextRef[];
  recentPaperContexts: PaperContextRef[];
  mineruImages: string[];
};

function filterPdfModePaperContexts(
  paperContexts: PaperContextRef[],
  pdfModePaperKeys?: Set<string>,
): PaperContextRef[] {
  if (!pdfModePaperKeys?.size) return paperContexts;
  return paperContexts.filter(
    (paper) => !pdfModePaperKeys.has(`${paper.itemId}:${paper.contextItemId}`),
  );
}

function dedupePaperContexts(
  paperContexts: PaperContextRef[],
): PaperContextRef[] {
  const deduped = new Map<string, PaperContextRef>();
  for (const paperContext of paperContexts) {
    const key = buildPaperKey(paperContext);
    if (!deduped.has(key)) {
      deduped.set(key, paperContext);
    }
  }
  return Array.from(deduped.values());
}

function excludeFullTextPaperContexts(
  paperContexts: PaperContextRef[],
  fullTextPaperContexts: PaperContextRef[],
): PaperContextRef[] {
  if (!paperContexts.length || !fullTextPaperContexts.length) {
    return paperContexts;
  }
  const fullTextKeys = new Set(
    fullTextPaperContexts.map((paperContext) => buildPaperKey(paperContext)),
  );
  return paperContexts.filter(
    (paperContext) => !fullTextKeys.has(buildPaperKey(paperContext)),
  );
}

function getCandidateTokenCost(candidate: PaperContextCandidate): number {
  const estimated = Number(
    (candidate as { estimatedTokens?: unknown }).estimatedTokens,
  );
  if (Number.isFinite(estimated) && estimated > 0) {
    return Math.max(1, Math.floor(estimated));
  }
  const chunkText =
    typeof (candidate as { chunkText?: unknown }).chunkText === "string"
      ? ((candidate as { chunkText?: string }).chunkText ?? "")
      : typeof (candidate as { text?: unknown }).text === "string"
        ? ((candidate as { text?: string }).text ?? "")
        : "";
  return Math.max(1, estimateTextTokens(chunkText));
}

function getCandidateRank(candidate: PaperContextCandidate): number {
  const hybrid = Number((candidate as { hybridScore?: unknown }).hybridScore);
  if (Number.isFinite(hybrid)) return hybrid;
  const score = Number((candidate as { score?: unknown }).score);
  if (Number.isFinite(score)) return score;
  return 0;
}

function sortCandidatesByRank(
  candidates: PaperContextCandidate[],
): PaperContextCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreDelta = getCandidateRank(b) - getCandidateRank(a);
    if (scoreDelta !== 0) return scoreDelta;
    return (a.chunkIndex || 0) - (b.chunkIndex || 0);
  });
}

function selectCandidatesWithinBudget(params: {
  paperContexts: PaperContextRef[];
  candidatesByPaper: Map<string, PaperContextCandidate[]>;
  contextBudgetTokens: number;
}): PaperContextCandidate[] {
  const selected: PaperContextCandidate[] = [];
  const selectedKeys = new Set<string>();
  let remainingTokens = Math.max(0, Math.floor(params.contextBudgetTokens));

  const selectCandidate = (candidate: PaperContextCandidate): boolean => {
    const key = `${candidate.paperKey}:${candidate.chunkIndex}`;
    if (selectedKeys.has(key)) return false;
    const tokenCost = getCandidateTokenCost(candidate);
    if (tokenCost > remainingTokens) return false;
    selected.push(candidate);
    selectedKeys.add(key);
    remainingTokens -= tokenCost;
    return true;
  };

  for (const paperContext of params.paperContexts) {
    const paperKey = buildPaperKey(paperContext);
    const ranked = params.candidatesByPaper.get(paperKey) || [];
    if (ranked.length > 0) {
      selectCandidate(ranked[0]);
    }
  }

  const globallyRanked = sortCandidatesByRank(
    Array.from(params.candidatesByPaper.values()).flat(),
  );
  for (const candidate of globallyRanked) {
    selectCandidate(candidate);
  }

  return selected;
}

function buildPaperRetrievalQuery(question: string): string {
  return sanitizeText(question).trim() || question;
}

function questionNeedsPaperCapabilityReminder(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(?:full text|full paper|whole paper|entire paper|entire article|whole article)\b/.test(
      normalized,
    ) ||
    /\b(?:all sections|all parts|entire document|complete paper)\b/.test(
      normalized,
    ) ||
    /\b(?:do you have access|can you access|can you read|did you read)\b/.test(
      normalized,
    ) ||
    /\b(?:coverage|scope|everything in the paper)\b/.test(normalized)
  );
}

function buildPaperFollowupAssistantInstruction(
  question: string,
): string | undefined {
  if (!questionNeedsPaperCapabilityReminder(question)) return undefined;
  return [
    "If the user asks about access or coverage, answer directly that you can",
    "access the paper's full text.",
    "Do not say that you lack access or only have snippets.",
    "Then say that, for this reply, you are using the abstract plus the most",
    "relevant retrieved chunks instead of quoting the entire paper text.",
  ].join(" ");
}

function appendBudgetedFullTextBlocks(params: {
  paperContexts: PaperContextRef[];
  getPdfContext: (contextItemId: number) => PdfContext | undefined;
  buildTruncatedFullPaperContext: (
    paperContext: PaperContextRef,
    pdfContext: PdfContext | undefined,
    options: { maxTokens: number },
  ) => { text: string };
  contextBlocks: string[];
  contextBudgetTokens: number;
}): { usedTokens: number; selectedPaperCount: number } {
  let remainingTokens = Math.max(0, Math.floor(params.contextBudgetTokens));
  let selectedPaperCount = 0;

  for (const [index, paperContext] of params.paperContexts.entries()) {
    if (remainingTokens <= 0) break;
    const papersRemaining = params.paperContexts.length - index;
    const maxTokens = Math.max(
      1,
      Math.floor(remainingTokens / papersRemaining),
    );
    const fullContext = params.buildTruncatedFullPaperContext(
      paperContext,
      params.getPdfContext(paperContext.contextItemId),
      { maxTokens },
    );
    const tokenCost = estimateTextTokens(fullContext.text);
    if (tokenCost <= 0) continue;
    params.contextBlocks.push(fullContext.text);
    remainingTokens = Math.max(0, remainingTokens - tokenCost);
    selectedPaperCount += 1;
  }

  return {
    usedTokens: Math.max(0, params.contextBudgetTokens - remainingTokens),
    selectedPaperCount,
  };
}

export async function buildLeanPaperContextPlanForRequest(
  params: LeanPaperContextPlanParams,
  deps: LeanPaperContextPlanDeps,
): Promise<LeanPaperContextPlan> {
  const contextSource = deps.resolveContextSourceItem(params.item);
  params.setStatusSafely("Loading paper context...", "sending");
  const firstPaperTurn = !params.history?.length;

  const uploadedPdfContext = (params.pdfUploadSystemMessages || [])
    .map((message) => sanitizeText(message).trim())
    .filter(Boolean)
    .join("\n\n");
  const uploadedPdfTokens = uploadedPdfContext
    ? estimateTextTokens(uploadedPdfContext)
    : 0;
  const contextBudget = estimateAvailableContextBudget({
    model: params.effectiveModel,
    prompt: params.question,
    history: params.history,
    images: params.images,
    reasoning: params.reasoning,
    maxTokens: params.advanced?.maxTokens,
    inputTokenCap: params.advanced?.inputTokenCap,
    systemPrompt: params.systemPrompt,
  });
  let remainingContextTokens = Math.max(
    0,
    contextBudget.contextBudgetTokens - uploadedPdfTokens,
  );

  const activePaperContext = (() => {
    const resolved = deps.resolvePaperContextRefFromAttachment(
      contextSource.contextItem,
    );
    if (!resolved) return null;
    if (
      params.pdfModePaperKeys?.has(
        `${resolved.itemId}:${resolved.contextItemId}`,
      )
    ) {
      return null;
    }
    return resolved;
  })();

  const fullTextPapers = dedupePaperContexts(
    filterPdfModePaperContexts(
      params.fullTextPaperContexts,
      params.pdfModePaperKeys,
    ),
  );
  const explicitPaperContexts = dedupePaperContexts(
    filterPdfModePaperContexts(params.paperContexts, params.pdfModePaperKeys),
  );
  const followupPaperContexts =
    explicitPaperContexts.length || fullTextPapers.length
      ? []
      : dedupePaperContexts(
          filterPdfModePaperContexts(
            params.recentPaperContexts,
            params.pdfModePaperKeys,
          ),
        );
  const displayPaperContexts = dedupePaperContexts(
    filterPdfModePaperContexts(
      [
        ...(activePaperContext ? [activePaperContext] : []),
        ...explicitPaperContexts,
        ...followupPaperContexts,
      ],
      params.pdfModePaperKeys,
    ),
  );
  const retrievalPapers = excludeFullTextPaperContexts(
    dedupePaperContexts(displayPaperContexts),
    fullTextPapers,
  );

  await deps.ensurePaperContextsCached(
    dedupePaperContexts([...retrievalPapers, ...fullTextPapers]),
    params.signal,
  );

  const contextBlocks: string[] = [];
  if (fullTextPapers.length && remainingContextTokens > 0) {
    const fullTextSelection = appendBudgetedFullTextBlocks({
      paperContexts: fullTextPapers,
      getPdfContext: deps.getPdfContext,
      buildTruncatedFullPaperContext: deps.buildTruncatedFullPaperContext,
      contextBlocks,
      contextBudgetTokens: remainingContextTokens,
    });
    if (fullTextSelection.selectedPaperCount > 0) {
      remainingContextTokens = Math.max(
        0,
        remainingContextTokens - fullTextSelection.usedTokens,
      );
      params.setStatusSafely(
        `Using full paper context (${fullTextSelection.selectedPaperCount})`,
        "sending",
      );
    }
  }

  let selectedChunkCount = 0;
  if (retrievalPapers.length && remainingContextTokens > 0) {
    const retrievalQuestion = buildPaperRetrievalQuery(params.question);
    const candidatesByPaper = new Map<string, PaperContextCandidate[]>();
    for (const paperContext of retrievalPapers) {
      const candidates = await deps.buildPaperRetrievalCandidates(
        paperContext,
        deps.getPdfContext(paperContext.contextItemId),
        retrievalQuestion,
        {
          topK: retrievalPapers.length === 1 ? 6 : 3,
          mode: "general",
        },
      );
      candidatesByPaper.set(
        buildPaperKey(paperContext),
        sortCandidatesByRank(candidates),
      );
    }

    const selectedCandidates = selectCandidatesWithinBudget({
      paperContexts: retrievalPapers,
      candidatesByPaper,
      contextBudgetTokens: remainingContextTokens,
    });
    selectedChunkCount = selectedCandidates.length;
    const evidencePack = deps.renderEvidencePack({
      papers: retrievalPapers,
      candidates: selectedCandidates,
    });
    if (evidencePack) {
      contextBlocks.push(evidencePack);
      params.setStatusSafely(
        `Using current-paper retrieval (${selectedChunkCount} chunks)`,
        "sending",
      );
    } else if (!fullTextPapers.length) {
      const fallbackPaper = retrievalPapers[0];
      const fallbackContext = deps.buildTruncatedFullPaperContext(
        fallbackPaper,
        deps.getPdfContext(fallbackPaper.contextItemId),
        { maxTokens: remainingContextTokens },
      );
      if (fallbackContext.text.trim()) {
        contextBlocks.push(fallbackContext.text);
        params.setStatusSafely("Using current paper text", "sending");
      }
    }
  }

  if (uploadedPdfContext) {
    contextBlocks.push(uploadedPdfContext);
  }

  if (!contextBlocks.length) {
    params.setStatusSafely("Ready", "ready");
  }

  const combinedContext = contextBlocks.filter(Boolean).join("\n\n---\n\n");
  const strategy: ContextAssemblyStrategy = fullTextPapers.length
    ? firstPaperTurn
      ? "paper-first-full"
      : "paper-manual-full"
    : firstPaperTurn
      ? "paper-explicit-retrieval"
      : "paper-followup-retrieval";
  const assistantInstruction =
    !firstPaperTurn && !fullTextPapers.length
      ? buildPaperFollowupAssistantInstruction(params.question)
      : undefined;
  const mineruImages = await deps.resolveContextPlanMineruImages({
    contextText: combinedContext,
    effectiveModel: params.effectiveModel,
    activeContextItemId: contextSource.contextItem?.id,
    paperContexts: retrievalPapers,
    fullTextPaperContexts: fullTextPapers,
  });

  return {
    combinedContext,
    strategy,
    assistantInstruction,
    paperContexts: displayPaperContexts,
    fullTextPaperContexts: fullTextPapers,
    recentPaperContexts: params.recentPaperContexts,
    mineruImages,
  };
}
