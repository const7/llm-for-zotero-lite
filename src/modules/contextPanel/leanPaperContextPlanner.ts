import type { ChatMessage } from "../../utils/llmClient";
import {
  buildEnrichedRetrievalQuery,
  buildPaperFollowupAssistantInstruction,
} from "./multiContextPlanner";
import { buildPaperKey } from "./pdfContext";
import { sanitizeText } from "./textUtils";
import type {
  ContextAssemblyStrategy,
  PaperContextCandidate,
  PaperContextRef,
  PdfContext,
} from "./types";

type StatusKind = "ready" | "sending" | "warning" | "error";

export type LeanPaperContextPlanParams = {
  item: Zotero.Item;
  question: string;
  paperContexts: PaperContextRef[];
  fullTextPaperContexts: PaperContextRef[];
  recentPaperContexts: PaperContextRef[];
  history: ChatMessage[];
  effectiveModel: string;
  pdfModePaperKeys?: Set<string>;
  pdfUploadSystemMessages?: string[];
  signal?: AbortSignal;
  setStatusSafely: (text: string, kind: StatusKind) => void;
};

export type LeanPaperContextPlanDeps = {
  resolveContextSourceItem: (
    item: Zotero.Item,
  ) => { statusText: string; contextItem: Zotero.Item | null };
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

export type LeanPaperContextPlan = {
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

function dedupePaperContexts(paperContexts: PaperContextRef[]): PaperContextRef[] {
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

export async function buildLeanPaperContextPlanForRequest(
  params: LeanPaperContextPlanParams,
  deps: LeanPaperContextPlanDeps,
): Promise<LeanPaperContextPlan> {
  const contextSource = deps.resolveContextSourceItem(params.item);
  params.setStatusSafely(contextSource.statusText, "sending");
  const firstPaperTurn = !params.history?.length;

  const uploadedPdfContext = (params.pdfUploadSystemMessages || [])
    .map((message) => sanitizeText(message).trim())
    .filter(Boolean)
    .join("\n\n");
  const activePaperContext = (() => {
    const resolved = deps.resolvePaperContextRefFromAttachment(
      contextSource.contextItem,
    );
    if (!resolved) return null;
    if (
      params.pdfModePaperKeys?.has(`${resolved.itemId}:${resolved.contextItemId}`)
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
  const displayPaperContexts = dedupePaperContexts(
    filterPdfModePaperContexts(
      [
        ...(activePaperContext ? [activePaperContext] : []),
        ...params.paperContexts,
      ],
      params.pdfModePaperKeys,
    ),
  );
  const retrievalPapers = excludeFullTextPaperContexts(
    dedupePaperContexts(
      displayPaperContexts,
    ),
    fullTextPapers,
  );

  await deps.ensurePaperContextsCached(
    dedupePaperContexts([...retrievalPapers, ...fullTextPapers]),
    params.signal,
  );

  const contextBlocks: string[] = [];
  if (fullTextPapers.length) {
    const maxTokensPerPaper = fullTextPapers.length === 1 ? 7000 : 3500;
    for (const paperContext of fullTextPapers) {
      const fullContext = deps.buildTruncatedFullPaperContext(
        paperContext,
        deps.getPdfContext(paperContext.contextItemId),
        { maxTokens: maxTokensPerPaper },
      );
      contextBlocks.push(fullContext.text);
    }
    params.setStatusSafely(
      `Using full paper context (${fullTextPapers.length})`,
      "sending",
    );
  }

  let selectedChunkCount = 0;
  if (retrievalPapers.length) {
    const retrievalQuestion = buildEnrichedRetrievalQuery(
      params.question,
      params.history,
    );
    const retrievalCandidates = (
      await Promise.all(
        retrievalPapers.map((paperContext) =>
          deps.buildPaperRetrievalCandidates(
            paperContext,
            deps.getPdfContext(paperContext.contextItemId),
            retrievalQuestion,
            {
              topK: retrievalPapers.length === 1 ? 6 : 3,
              mode: "general",
            },
          ),
        ),
      )
    ).flat();
    selectedChunkCount = retrievalCandidates.length;
    const evidencePack = deps.renderEvidencePack({
      papers: retrievalPapers,
      candidates: retrievalCandidates,
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
        { maxTokens: 5000 },
      );
      contextBlocks.push(fallbackContext.text);
      params.setStatusSafely("Using current paper text", "sending");
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
