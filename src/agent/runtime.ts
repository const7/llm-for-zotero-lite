import { AgentToolRegistry } from "./tools/registry";
import { readAttachmentBytes } from "../modules/contextPanel/attachmentStorage";
import type {
  AgentModelContentPart,
  AgentConfirmationResolution,
  AgentEvent,
  AgentModelMessage,
  AgentRuntimeOutcome,
  AgentRuntimeRequest,
  AgentToolArtifact,
  AgentToolContext,
  AgentToolResult,
} from "./types";
import type { AgentModelAdapter } from "./model/adapter";
import {
  appendAgentRunEvent,
  createAgentRun,
  finishAgentRun,
  getAgentRunTrace,
} from "./store/traceStore";

type AgentRuntimeDeps = {
  registry: AgentToolRegistry;
  adapterFactory: (request: AgentRuntimeRequest) => AgentModelAdapter;
  now?: () => number;
};

type PendingConfirmation = {
  resolve: (resolution: AgentConfirmationResolution) => void;
};

function createRunId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function stringifyToolResult(result: AgentToolResult): string {
  return JSON.stringify(result.content ?? {}, null, 2);
}

function encodeBytesBase64(bytes: Uint8Array): string {
  let out = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(bytes.length, index + chunkSize));
    out += String.fromCharCode(...chunk);
  }
  const btoaFn =
    (globalThis as typeof globalThis & { btoa?: (value: string) => string }).btoa;
  if (typeof btoaFn !== "function") {
    throw new Error("btoa is unavailable");
  }
  return btoaFn(out);
}

async function toDataUrl(
  storedPath: string,
  mimeType: string,
): Promise<string> {
  const bytes = await readAttachmentBytes(storedPath);
  return `data:${mimeType};base64,${encodeBytesBase64(bytes)}`;
}

function summarizeArtifacts(artifacts: AgentToolArtifact[]): string {
  const imagePages = artifacts
    .filter((artifact): artifact is Extract<AgentToolArtifact, { kind: "image" }> => {
      return artifact.kind === "image";
    })
    .map((artifact) => artifact.pageLabel || (Number.isFinite(artifact.pageIndex) ? `${artifact.pageIndex! + 1}` : ""));
  const fileTitles = artifacts
    .filter((artifact): artifact is Extract<AgentToolArtifact, { kind: "file_ref" }> => {
      return artifact.kind === "file_ref";
    })
    .map((artifact) => artifact.title || artifact.name);
  const parts: string[] = [];
  if (imagePages.length) {
    parts.push(
      `Prepared PDF page image${imagePages.length === 1 ? "" : "s"} (${imagePages
        .filter(Boolean)
        .map((entry) => `p${entry}`)
        .join(", ") || `${imagePages.length} page${imagePages.length === 1 ? "" : "s"}`}) for visual inspection.`,
    );
  }
  if (fileTitles.length) {
    parts.push(
      `Prepared the PDF file${fileTitles.length === 1 ? "" : "s"} ${fileTitles
        .map((entry) => `"${entry}"`)
        .join(", ")} for direct reading.`,
    );
  }
  parts.push(
    "Use the attached pages or PDF directly when answering. Do not ask the user to re-upload them.",
  );
  return parts.join(" ");
}

async function buildArtifactFollowupMessage(
  result: AgentToolResult,
): Promise<AgentModelMessage | null> {
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  if (!artifacts.length || !result.ok) return null;
  const parts: AgentModelContentPart[] = [
    {
      type: "text",
      text: summarizeArtifacts(artifacts),
    },
  ];
  for (const artifact of artifacts) {
    if (artifact.kind === "image") {
      if (!artifact.storedPath || !artifact.mimeType) continue;
      try {
        const url = await toDataUrl(artifact.storedPath, artifact.mimeType);
        parts.push({
          type: "image_url",
          image_url: {
            url,
            detail: "high",
          },
        });
      } catch (error) {
        ztoolkit.log("LLM Agent: Failed to load image artifact", artifact, error);
      }
      continue;
    }
    parts.push({
      type: "file_ref",
      file_ref: {
        name: artifact.name,
        mimeType: artifact.mimeType,
        storedPath: artifact.storedPath,
        contentHash: artifact.contentHash,
      },
    });
  }
  return parts.length > 1
    ? {
        role: "user",
        content: parts,
      }
    : null;
}

export class AgentRuntime {
  private readonly registry: AgentToolRegistry;
  private readonly adapterFactory: AgentRuntimeDeps["adapterFactory"];
  private readonly now: () => number;
  private readonly pendingConfirmations = new Map<string, PendingConfirmation>();

  constructor(deps: AgentRuntimeDeps) {
    this.registry = deps.registry;
    this.adapterFactory = deps.adapterFactory;
    this.now = deps.now || (() => Date.now());
  }

  listTools() {
    return this.registry.listTools();
  }

  getCapabilities(request: AgentRuntimeRequest) {
    return this.adapterFactory(request).getCapabilities(request);
  }

  resolveConfirmation(
    requestId: string,
    approvedOrResolution: boolean | AgentConfirmationResolution,
    data?: unknown,
  ): boolean {
    const pending = this.pendingConfirmations.get(requestId);
    if (!pending) return false;
    this.pendingConfirmations.delete(requestId);
    const resolution =
      typeof approvedOrResolution === "boolean"
        ? {
            approved: approvedOrResolution,
            data,
          }
        : {
            approved: Boolean(approvedOrResolution.approved),
            data: approvedOrResolution.data,
          };
    pending.resolve(resolution);
    return true;
  }

  async getRunTrace(runId: string) {
    return getAgentRunTrace(runId);
  }

  async runTurn(params: {
    request: AgentRuntimeRequest;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
    onStart?: (runId: string) => void | Promise<void>;
    signal?: AbortSignal;
  }): Promise<AgentRuntimeOutcome> {
    const request = params.request;
    const runId = createRunId();
    const adapter = this.adapterFactory(request);
    let eventSeq = 0;
    let currentAnswerText = "";
    const item = request.item || null;
    await createAgentRun({
      runId,
      conversationKey: request.conversationKey,
      mode: "agent",
      model: request.model,
      status: "running",
      createdAt: this.now(),
    });
    await params.onStart?.(runId);

    const emit = async (event: AgentEvent) => {
      eventSeq += 1;
      await appendAgentRunEvent(runId, eventSeq, event);
      await params.onEvent?.(event);
    };

    if (!adapter.supportsTools(request)) {
      const reason = "Agent tools unavailable for this model; used direct response instead.";
      await emit({
        type: "fallback",
        reason,
      });
      await finishAgentRun(runId, "completed");
      return {
        kind: "fallback",
        runId,
        reason,
        usedFallback: true,
      };
    }

    const context: AgentToolContext = {
      request,
      item,
      currentAnswerText,
      modelName: request.model || "unknown",
      modelProviderLabel: request.modelProviderLabel,
    };
    const messages = adapter.buildInitialMessages
      ? adapter.buildInitialMessages(request)
      : ([] as AgentModelMessage[]);

    let consecutiveToolErrors = 0;
    const maxRounds = 4;
    const maxToolCallsPerRound = 3;
    for (let round = 1; round <= maxRounds; round += 1) {
      if (params.signal?.aborted) {
        await finishAgentRun(runId, "cancelled", currentAnswerText);
        throw new Error("Aborted");
      }
      await emit({
        type: "status",
        text: round === 1 ? "Running agent" : `Continuing agent (${round}/${maxRounds})`,
      });
      const step = await adapter.runStep({
        request,
        messages,
        tools: this.registry.listTools(),
        signal: params.signal,
      });
      if (step.kind === "final") {
        const finalText = step.text || currentAnswerText || "No response.";
        if (finalText) {
          currentAnswerText = finalText;
          await emit({
            type: "message_delta",
            text: finalText,
          });
        }
        await emit({
          type: "final",
          text: finalText,
        });
        await finishAgentRun(runId, "completed", finalText);
        return {
          kind: "completed",
          runId,
          text: finalText,
          usedFallback: false,
        };
      }

      messages.push(step.assistantMessage);
      const calls = step.calls.slice(0, maxToolCallsPerRound);
      if (!calls.length) break;
      for (const call of calls) {
        await emit({
          type: "tool_call",
          callId: call.id,
          name: call.name,
          args: call.arguments,
        });
        const execution = await this.registry.prepareExecution(call, {
          ...context,
          currentAnswerText,
        });
        let toolResult: AgentToolResult;
        if (execution.kind === "confirmation") {
          const approval = new Promise<AgentConfirmationResolution>((resolve) => {
            this.pendingConfirmations.set(execution.requestId, { resolve });
          });
          await emit({
            type: "confirmation_required",
            requestId: execution.requestId,
            action: execution.action,
          });
          const resolution = await approval;
          await emit({
            type: "confirmation_resolved",
            requestId: execution.requestId,
            approved: resolution.approved,
            data: resolution.data,
          });
          toolResult = resolution.approved
            ? await execution.execute(resolution.data)
            : execution.deny(resolution.data);
        } else {
          toolResult = execution.result;
        }
        if (toolResult.ok) {
          consecutiveToolErrors = 0;
        } else {
          consecutiveToolErrors += 1;
        }
        await emit({
          type: "tool_result",
          callId: toolResult.callId,
          name: toolResult.name,
          ok: toolResult.ok,
          content: toolResult.content,
          artifacts: toolResult.artifacts,
        });
        messages.push({
          role: "tool",
          tool_call_id: toolResult.callId,
          name: toolResult.name,
          content: stringifyToolResult(toolResult),
        });
        const followupMessage = await buildArtifactFollowupMessage(toolResult);
        if (followupMessage) {
          messages.push(followupMessage);
        }
        if (consecutiveToolErrors >= 2) {
          const finalText =
            currentAnswerText ||
            "Agent stopped after repeated tool errors. Please adjust the request and try again.";
          await emit({
            type: "final",
            text: finalText,
          });
          await finishAgentRun(runId, "failed", finalText);
          return {
            kind: "completed",
            runId,
            text: finalText,
            usedFallback: false,
          };
        }
      }
    }

    const finalText =
      currentAnswerText ||
      "Agent stopped before reaching a final answer. Try narrowing the request.";
    await emit({
      type: "final",
      text: finalText,
    });
    await finishAgentRun(runId, "failed", finalText);
    return {
      kind: "completed",
      runId,
      text: finalText,
      usedFallback: false,
    };
  }
}
