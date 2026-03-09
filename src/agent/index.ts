import { AgentRuntime } from "./runtime";
import { createBuiltInToolRegistry } from "./tools";
import { OpenAICompatibleAgentAdapter } from "./model/openaiCompatible";
import { CodexResponsesAgentAdapter } from "./model/codexResponses";
import { ZoteroGateway } from "./services/zoteroGateway";
import { PdfService } from "./services/pdfService";
import { RetrievalService } from "./services/retrievalService";
import {
  initAgentTraceStore,
  getAgentRunTrace,
} from "./store/traceStore";
import type {
  AgentEvent,
  AgentRuntimeRequest,
} from "./types";

let runtime: AgentRuntime | null = null;

function createToolRegistry() {
  const zoteroGateway = new ZoteroGateway();
  const pdfService = new PdfService();
  const retrievalService = new RetrievalService(pdfService);
  return createBuiltInToolRegistry({
    zoteroGateway,
    pdfService,
    retrievalService,
  });
}

export async function initAgentSubsystem(): Promise<AgentRuntime> {
  if (runtime) return runtime;
  await initAgentTraceStore();
  runtime = new AgentRuntime({
    registry: createToolRegistry(),
    adapterFactory: (request) =>
      request.authMode === "codex_auth"
        ? new CodexResponsesAgentAdapter()
        : new OpenAICompatibleAgentAdapter(),
  });
  return runtime;
}

export function getAgentRuntime(): AgentRuntime {
  if (!runtime) {
    throw new Error("Agent subsystem is not initialized");
  }
  return runtime;
}

export function getAgentApi() {
  return {
    runTurn: (
      request: AgentRuntimeRequest,
      onEvent?: (event: AgentEvent) => void | Promise<void>,
    ) => getAgentRuntime().runTurn({ request, onEvent }),
    listTools: () => getAgentRuntime().listTools(),
    getCapabilities: (request: AgentRuntimeRequest) =>
      getAgentRuntime().getCapabilities(request),
    getRunTrace: (runId: string) => getAgentRunTrace(runId),
    resolveConfirmation: (
      requestId: string,
      approved: boolean,
      data?: unknown,
    ) => getAgentRuntime().resolveConfirmation(requestId, approved, data),
  };
}
