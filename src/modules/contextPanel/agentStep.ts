/**
 * agentStep.ts
 *
 * One iteration of the ReAct loop: build a context snapshot, call the LLM once,
 * and parse the response into an AgentStepDecision (stop | tool call).
 *
 * Unlike the old two-call planner/continuation design, there is no hardcoded
 * routing logic — the model sees its full context and decides what to do next.
 */

import { callLLM, type ReasoningConfig } from "../../utils/llmClient";
import { getAgentToolDefinitions } from "./agentTools/registry";
import { formatPaperContextReferenceLabel } from "./paperAttribution";
import { isLibraryOverviewQuery, isLibraryScopedSearchQuery } from "./agentContext";
import { sanitizeText } from "./textUtils";
import {
  MAX_AGENT_TRACE_LINES,
  MAX_AGENT_TRACE_LINE_LENGTH,
} from "./agentConfig";
import type { AgentStepContext, AgentStepDecision, AgentExecutedStep } from "./agentTypes";
import type { AgentToolCall, AgentToolTarget } from "./agentTools/types";
import type { PaperContextRef } from "./types";

// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────

function dedupePaperContexts(
  values: (PaperContextRef | null | undefined)[],
): PaperContextRef[] {
  const out: PaperContextRef[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const key = `${value.itemId}:${value.contextItemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function formatPaperTargetLine(
  scope: string,
  index: number,
  paper: PaperContextRef,
): string {
  const label = formatPaperContextReferenceLabel(paper);
  return `- ${scope}#${index}: ${label || paper.title}`;
}

function buildAvailableTargetLines(ctx: AgentStepContext): string[] {
  const lines: string[] = [];

  const selected = dedupePaperContexts(ctx.selectedPaperContexts);
  for (const [i, paper] of selected.entries()) {
    lines.push(formatPaperTargetLine("selected-paper", i + 1, paper));
  }

  const pinned = dedupePaperContexts(ctx.pinnedPaperContexts);
  for (const [i, paper] of pinned.entries()) {
    lines.push(formatPaperTargetLine("pinned-paper", i + 1, paper));
  }

  const recent = dedupePaperContexts(ctx.recentPaperContexts);
  for (const [i, paper] of recent.entries()) {
    lines.push(formatPaperTargetLine("recent-paper", i + 1, paper));
  }

  const retrieved = dedupePaperContexts(ctx.retrievedPaperContexts);
  for (const [i, paper] of retrieved.entries()) {
    lines.push(formatPaperTargetLine("retrieved-paper", i + 1, paper));
  }

  if (ctx.activePaperContext) {
    const label = formatPaperContextReferenceLabel(ctx.activePaperContext);
    lines.push(`- active-paper: ${label || ctx.activePaperContext.title}`);
  }

  return lines.length ? lines : ["- (none yet)"];
}

function buildExecutedStepsLines(steps: AgentExecutedStep[]): string[] {
  if (!steps.length) return ["- none"];
  return steps.map((s) => `- ${s.summary}`);
}

function buildContextHint(ctx: AgentStepContext): string {
  const question = sanitizeText(ctx.question || "").trim();
  const hints: string[] = [];
  if (ctx.libraryID > 0) {
    if (isLibraryOverviewQuery(question)) {
      hints.push("Hint: this question asks about the whole library — consider calling list_papers.");
    } else if (isLibraryScopedSearchQuery(question, ctx.conversationMode)) {
      hints.push("Hint: this looks like a library-search question — consider calling list_papers with a relevant query.");
    }
  }
  return hints.join("\n");
}

function buildToolDescriptionLines(): string[] {
  const lines = ["Available tools:"];
  for (const def of getAgentToolDefinitions()) {
    lines.push(`- "${def.name}": ${def.plannerDescription}`);
    lines.push(`  Example: ${def.callExample}`);
  }
  lines.push("");
  lines.push("Target scopes for paper tools:");
  lines.push(
    "  active-paper | selected-paper#N | pinned-paper#N | recent-paper#N | retrieved-paper#N",
  );
  lines.push(
    "  (retrieved-paper#N becomes available after list_papers has been called)",
  );
  return lines;
}

function buildStepPrompt(ctx: AgentStepContext): string {
  const question = sanitizeText(ctx.question || "").trim() || "(empty)";
  const hint = buildContextHint(ctx);

  return [
    "You are the retrieval agent for a Zotero research assistant.",
    "Do NOT answer the user's question. Decide only the next retrieval step.",
    "",
    ...buildToolDescriptionLines(),
    "",
    "Return JSON only — one of:",
    '  Stop:  {"decision":"stop","traceLines":["Sufficient evidence retrieved — ready to answer."]}',
    '  Tool:  {"decision":"tool","call":{<tool JSON>},"traceLines":["Reading evidence from the active paper."]}',
    "",
    "Rules:",
    "- Stop as soon as enough grounding exists to answer the question.",
    "- Never repeat a tool call that already appears in \"Steps taken so far\". If a tool shows \"complete\" in the steps, choose stop instead.",
    "- Prefer find_claim_evidence when targeted evidence snippets are sufficient.",
    "- Prefer read_references when the user asks what a paper cites.",
    "- Call list_papers before using retrieved-paper#N targets (they don't exist yet otherwise).",
    "- traceLines: exactly 1 short action line (\u2264 80 chars). State what you are doing or why you are stopping. No multi-sentence reasoning.",
    "",
    `Step ${ctx.iterationIndex + 1} of ${ctx.maxIterations}`,
    `Remaining context budget: ~${ctx.remainingBudgetTokens} tokens`,
    `User question: ${question}`,
    `Conversation mode: ${ctx.conversationMode}`,
    `Library available: ${ctx.libraryID > 0 ? "yes" : "no"}`,
    hint,
    "",
    "Available targets:",
    ...buildAvailableTargetLines(ctx),
    "",
    "Steps taken so far:",
    ...buildExecutedStepsLines(ctx.executedSteps),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

// ──────────────────────────────────────────────
//  JSON extraction & parsing
// ──────────────────────────────────────────────

/** Extract the first complete JSON object from raw model output. */
export function findAgentPlanJsonObject(raw: string): string {
  const source = String(raw || "");
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return "";
}

function normalizeTraceLines(value: unknown): string[] {
  const rawLines = Array.isArray(value) ? value : [];
  return rawLines
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => sanitizeText(entry).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, MAX_AGENT_TRACE_LINE_LENGTH))
    .slice(0, MAX_AGENT_TRACE_LINES);
}

function normalizeToolTarget(value: unknown): AgentToolTarget | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as { scope?: unknown; index?: unknown };
  const scope = sanitizeText(String(typed.scope || "")).trim().toLowerCase();
  switch (scope) {
    case "active-paper":
      return { scope: "active-paper" };
    case "selected-paper":
    case "pinned-paper":
    case "recent-paper":
    case "retrieved-paper": {
      const index = Math.floor(Number(typed.index));
      if (!Number.isFinite(index) || index < 1) return null;
      return { scope, index } as AgentToolTarget;
    }
    default:
      return null;
  }
}

function normalizeToolCall(value: unknown): AgentToolCall | null {
  if (!value || typeof value !== "object") return null;
  const typed = value as {
    name?: unknown;
    target?: unknown;
    query?: unknown;
    limit?: unknown;
  };
  const name = sanitizeText(String(typed.name || ""))
    .trim()
    .toLowerCase();

  if (name === "list_papers") {
    const query = sanitizeText(String(typed.query || "")).trim();
    const rawLimit = Number(typed.limit || 0);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.max(1, Math.min(12, Math.floor(rawLimit)))
        : 6;
    return { name: "list_papers", query: query || undefined, limit };
  }

  const paperTools = ["read_paper_text", "find_claim_evidence", "read_references"] as const;
  if (paperTools.includes(name as (typeof paperTools)[number])) {
    const target = normalizeToolTarget(typed.target);
    if (!target) return null;
    return {
      name: name as (typeof paperTools)[number],
      target,
    };
  }

  return null;
}

function buildFallbackStopDecision(): AgentStepDecision {
  return {
    type: "stop",
    traceLines: ["Stopping — planner returned an unrecognised response."],
  };
}

/** Parse an LLM response string into an AgentStepDecision. */
export function parseAgentStepDecision(raw: string): AgentStepDecision {
  const jsonText = findAgentPlanJsonObject(raw);
  if (!jsonText) return buildFallbackStopDecision();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return buildFallbackStopDecision();
  }

  if (!parsed || typeof parsed !== "object") return buildFallbackStopDecision();
  const typed = parsed as { decision?: unknown; call?: unknown; traceLines?: unknown };
  const decision = sanitizeText(String(typed.decision || "")).trim().toLowerCase();
  const traceLines = normalizeTraceLines(typed.traceLines);

  if (decision === "stop") {
    return { type: "stop", traceLines };
  }

  if (decision === "tool") {
    const call = normalizeToolCall(typed.call);
    if (!call) return buildFallbackStopDecision();
    return { type: "tool", call, traceLines };
  }

  return buildFallbackStopDecision();
}

// ──────────────────────────────────────────────
//  Exported runner
// ──────────────────────────────────────────────

export async function runAgentStep(ctx: AgentStepContext): Promise<AgentStepDecision> {
  const fallback = buildFallbackStopDecision();
  const question = sanitizeText(ctx.question || "").trim();
  if (!question) return fallback;

  try {
    const raw = await callLLM({
      prompt: buildStepPrompt(ctx),
      model: ctx.model,
      apiBase: ctx.apiBase,
      apiKey: ctx.apiKey,
      reasoning: ctx.reasoning,
      temperature: 0,
      maxTokens: 500,
    });
    return parseAgentStepDecision(raw);
  } catch (err) {
    ztoolkit.log("LLM: Agent step planner failed, stopping", err);
    return fallback;
  }
}

export type { AgentStepContext, AgentStepDecision, AgentExecutedStep };
export type AgentStepRunnerFn = (ctx: AgentStepContext) => Promise<AgentStepDecision>;

// Re-export the LLM params for callers that build them externally
export type AgentStepLLMParams = Pick<
  AgentStepContext,
  "model" | "apiBase" | "apiKey" | "reasoning"
>;
