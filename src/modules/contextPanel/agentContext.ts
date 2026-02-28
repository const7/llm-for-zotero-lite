import { formatPaperCitationLabel } from "./paperAttribution";
import {
  listLibraryPaperCandidates,
  searchPaperCandidates,
  type PaperSearchGroupCandidate,
} from "./paperSearch";
import { sanitizeText } from "./textUtils";
import type { PaperContextRef } from "./types";

const MAX_LIBRARY_OVERVIEW_LIST = 40;
const MAX_LIBRARY_OVERVIEW_READ = 12;
const MAX_LIBRARY_SEARCH_LIST = 12;
const MAX_LIBRARY_SEARCH_READ = 6;

export type AgentContextResolution = {
  mode: "library-overview" | "library-search";
  contextPrefix: string;
  paperContexts: PaperContextRef[];
  pinnedPaperContexts: PaperContextRef[];
  statusText: string;
};

function normalizeQuestionText(value: string): string {
  return sanitizeText(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasLibraryReference(normalizedQuestion: string): boolean {
  return (
    /\b(?:my|the|this)\s+(?:zotero\s+)?(?:library|collection)\b/.test(
      normalizedQuestion,
    ) ||
    /\b(?:in|from|within|across)\s+(?:my|the|this)\s+(?:zotero\s+)?(?:library|collection)\b/.test(
      normalizedQuestion,
    ) ||
    /\bzotero\s+library\b/.test(normalizedQuestion)
  );
}

export function isLibraryOverviewQuery(question: string): boolean {
  const normalizedQuestion = normalizeQuestionText(question);
  if (!normalizedQuestion) return false;
  return [
    /\b(?:read|scan|summari[sz]e|overview|review|analy[sz]e|describe|tell me about)\b.*\b(?:my|the|this)\s+(?:zotero\s+)?(?:library|collection)\b/,
    /\b(?:whole|entire|full|complete)\s+(?:zotero\s+)?(?:library|collection)\b/,
    /\bwhat(?:'s| is)\s+in\s+(?:my|the|this)\s+(?:zotero\s+)?(?:library|collection)\b/,
    /\b(?:all|every)\s+(?:papers?|articles?|studies?)\s+in\s+(?:my|the|this)\s+(?:zotero\s+)?(?:library|collection)\b/,
  ].some((pattern) => pattern.test(normalizedQuestion));
}

export function isLibraryScopedSearchQuery(
  question: string,
  conversationMode: "paper" | "open",
): boolean {
  const normalizedQuestion = normalizeQuestionText(question);
  if (!normalizedQuestion || isLibraryOverviewQuery(normalizedQuestion)) {
    return false;
  }
  if (hasLibraryReference(normalizedQuestion)) {
    return true;
  }
  if (conversationMode !== "open") {
    return false;
  }
  return (
    ((/\b(?:which|find|show|list|compare|review|search|look for)\b/.test(
      normalizedQuestion,
    ) &&
      /\b(?:paper|papers|study|studies|article|articles|author|authors|work|works)\b/.test(
        normalizedQuestion,
      )) ||
      /\bwhat\s+(?:papers|studies|articles|authors|works)\b/.test(
        normalizedQuestion,
      ))
  );
}

function buildPaperContextRef(
  candidate: PaperSearchGroupCandidate,
): PaperContextRef | null {
  const attachment = candidate.attachments[0];
  if (!attachment) return null;
  return {
    itemId: candidate.itemId,
    contextItemId: attachment.contextItemId,
    title: candidate.title,
    citationKey: candidate.citationKey,
    firstCreator: candidate.firstCreator,
    year: candidate.year,
  };
}

function dedupePaperContexts(values: PaperContextRef[]): PaperContextRef[] {
  const out: PaperContextRef[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = `${value.itemId}:${value.contextItemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function formatPaperListLine(
  candidate: PaperSearchGroupCandidate,
  index: number,
): string {
  const ref = buildPaperContextRef(candidate);
  const citation = ref ? formatPaperCitationLabel(ref) : "";
  return `${index + 1}. ${candidate.title}${citation ? ` - ${citation}` : ""}`;
}

function buildGroundingRulesBlock(extraLine: string): string[] {
  return [
    "- Grounding rule: Use only the retrieved Zotero library snapshot and paper contexts below.",
    "- Do not invent library-wide statistics, item counts, tags, annotation counts, citation counts, or subject breakdowns that are not explicitly present in the retrieved data.",
    extraLine,
  ];
}

function buildLibraryOverviewContext(
  candidates: PaperSearchGroupCandidate[],
): string {
  const listedCandidates = candidates.slice(0, MAX_LIBRARY_OVERVIEW_LIST);
  const lines = [
    "Zotero Agent Retrieval",
    "- Mode: whole-library overview",
    `- Readable PDF-backed papers found in the active Zotero library: ${candidates.length}`,
    `- Papers loaded for detailed reading in this answer: ${Math.min(candidates.length, MAX_LIBRARY_OVERVIEW_READ)}`,
    ...buildGroundingRulesBlock(
      "- If the user asks for information outside this retrieved snapshot, say that you do not have enough grounded Zotero data.",
    ),
    "",
    "Retrieved library paper list:",
    ...listedCandidates.map((candidate, index) =>
      formatPaperListLine(candidate, index),
    ),
  ];
  if (candidates.length > listedCandidates.length) {
    lines.push(
      `- Additional readable papers not listed here due to brevity: ${candidates.length - listedCandidates.length}`,
    );
  }
  return lines.join("\n");
}

function buildLibrarySearchContext(
  question: string,
  candidates: PaperSearchGroupCandidate[],
): string {
  const listedCandidates = candidates.slice(0, MAX_LIBRARY_SEARCH_LIST);
  const lines = [
    "Zotero Agent Retrieval",
    "- Mode: library search",
    `- User request: ${sanitizeText(question).trim() || "(empty)"}`,
    `- Matched readable PDF-backed papers: ${candidates.length}`,
    `- Papers loaded for detailed reading in this answer: ${Math.min(candidates.length, MAX_LIBRARY_SEARCH_READ)}`,
    ...buildGroundingRulesBlock(
      "- If there are no retrieved matches for a claim, say that the current Zotero retrieval did not find evidence for it.",
    ),
    "",
    "Top retrieved library matches:",
    ...listedCandidates.map((candidate, index) =>
      formatPaperListLine(candidate, index),
    ),
  ];
  if (candidates.length > listedCandidates.length) {
    lines.push(
      `- Additional readable matches not listed here due to brevity: ${candidates.length - listedCandidates.length}`,
    );
  }
  return lines.join("\n");
}

function buildNoResultsContext(
  mode: AgentContextResolution["mode"],
  question: string,
): string {
  return [
    "Zotero Agent Retrieval",
    `- Mode: ${mode === "library-overview" ? "whole-library overview" : "library search"}`,
    `- User request: ${sanitizeText(question).trim() || "(empty)"}`,
    "- No readable PDF-backed papers were retrieved from the active Zotero library for this request.",
    "- Grounding rule: Do not invent library contents, counts, author frequencies, document types, or paper summaries.",
    "- Instead, say that no grounded Zotero library data was retrieved for the request.",
  ].join("\n");
}

export async function resolveAgentContext(params: {
  question: string;
  libraryID: number;
  conversationMode: "paper" | "open";
  onStatus?: (statusText: string) => void;
}): Promise<AgentContextResolution | null> {
  const normalizedLibraryID = Number(params.libraryID);
  if (!Number.isFinite(normalizedLibraryID) || normalizedLibraryID <= 0) {
    return null;
  }

  if (isLibraryOverviewQuery(params.question)) {
    params.onStatus?.("Reading library metadata now...");
    const candidates = await listLibraryPaperCandidates(normalizedLibraryID);
    const paperContexts = dedupePaperContexts(
      candidates
        .slice(0, MAX_LIBRARY_OVERVIEW_READ)
        .map((candidate) => buildPaperContextRef(candidate))
        .filter((candidate): candidate is PaperContextRef => Boolean(candidate)),
    );
    return {
      mode: "library-overview",
      contextPrefix: candidates.length
        ? buildLibraryOverviewContext(candidates)
        : buildNoResultsContext("library-overview", params.question),
      paperContexts,
      pinnedPaperContexts: paperContexts,
      statusText: candidates.length
        ? `Reading library (${candidates.length} papers)`
        : "No readable library papers found",
    };
  }

  if (isLibraryScopedSearchQuery(params.question, params.conversationMode)) {
    params.onStatus?.("Searching library metadata now...");
    const candidates = await searchPaperCandidates(
      normalizedLibraryID,
      params.question,
      null,
      MAX_LIBRARY_SEARCH_LIST,
    );
    const paperContexts = dedupePaperContexts(
      candidates
        .slice(0, MAX_LIBRARY_SEARCH_READ)
        .map((candidate) => buildPaperContextRef(candidate))
        .filter((candidate): candidate is PaperContextRef => Boolean(candidate)),
    );
    return {
      mode: "library-search",
      contextPrefix: candidates.length
        ? buildLibrarySearchContext(params.question, candidates)
        : buildNoResultsContext("library-search", params.question),
      paperContexts,
      pinnedPaperContexts: paperContexts,
      statusText: candidates.length
        ? `Searching library (${candidates.length} matches)`
        : "No readable library matches found",
    };
  }

  return null;
}
