import { AgentRuntime } from "./runtime";
import { createBuiltInToolRegistry } from "./tools";
import { OpenAICompatibleAgentAdapter } from "./model/openaiCompatible";
import { CodexResponsesAgentAdapter } from "./model/codexResponses";
import { ZoteroGateway } from "./services/zoteroGateway";
import { PdfService } from "./services/pdfService";
import { PdfPageService } from "./services/pdfPageService";
import { RetrievalService } from "./services/retrievalService";
import { providerSupportsResponsesEndpoint } from "../utils/providerPresets";
import { isResponsesBase } from "../utils/apiHelpers";
import { OpenAIResponsesAgentAdapter } from "./model/openaiResponses";
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
  const pdfPageService = new PdfPageService(pdfService, zoteroGateway);
  const retrievalService = new RetrievalService(pdfService);
  return createBuiltInToolRegistry({
    zoteroGateway,
    pdfService,
    pdfPageService,
    retrievalService,
  });
}

export async function initAgentSubsystem(): Promise<AgentRuntime> {
  if (runtime) return runtime;
  await initAgentTraceStore();
  runtime = new AgentRuntime({
    registry: createToolRegistry(),
    adapterFactory: (request) => {
      if (request.authMode === "codex_auth") {
        return new CodexResponsesAgentAdapter();
      }
      const apiBase = (request.apiBase || "").trim();
      if (
        apiBase &&
        (isResponsesBase(apiBase) || providerSupportsResponsesEndpoint(apiBase))
      ) {
        return new OpenAIResponsesAgentAdapter();
      }
      return new OpenAICompatibleAgentAdapter();
    },
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
