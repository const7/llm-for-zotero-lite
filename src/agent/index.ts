import { AgentRuntime } from "./runtime";
import { AgentToolRegistry } from "./tools/registry";
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
  AgentToolInputValidation,
  AgentToolDefinition,
} from "./types";
import type { PaperContextRef, ChatAttachment } from "../modules/contextPanel/types";
import { isGlobalPortalItem } from "../modules/contextPanel/portalScope";

let runtime: AgentRuntime | null = null;

function validateObject<T extends Record<string, unknown>>(
  value: unknown,
): value is T {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ok<T>(value: T): AgentToolInputValidation<T> {
  return { ok: true, value };
}

function fail<T>(error: string): AgentToolInputValidation<T> {
  return { ok: false, error };
}

function normalizePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function normalizeToolPaperContext(
  value: Record<string, unknown>,
): PaperContextRef | null {
  const itemId = normalizePositiveInt(value.itemId);
  const contextItemId = normalizePositiveInt(value.contextItemId);
  if (!itemId || !contextItemId) return null;
  return {
    itemId,
    contextItemId,
    title:
      typeof value.title === "string" && value.title.trim()
        ? value.title.trim()
        : `Paper ${itemId}`,
    attachmentTitle:
      typeof value.attachmentTitle === "string" && value.attachmentTitle.trim()
        ? value.attachmentTitle.trim()
        : undefined,
    citationKey:
      typeof value.citationKey === "string" && value.citationKey.trim()
        ? value.citationKey.trim()
        : undefined,
    firstCreator:
      typeof value.firstCreator === "string" && value.firstCreator.trim()
        ? value.firstCreator.trim()
        : undefined,
    year:
      typeof value.year === "string" && value.year.trim()
        ? value.year.trim()
        : undefined,
  };
}

function findAttachment(
  attachments: ChatAttachment[] | undefined,
  args: { attachmentId?: string; name?: string },
): ChatAttachment | null {
  const list = Array.isArray(attachments) ? attachments : [];
  if (args.attachmentId) {
    const byId = list.find((entry) => entry.id === args.attachmentId);
    if (byId) return byId;
  }
  if (args.name) {
    const byName = list.find((entry) => entry.name === args.name);
    if (byName) return byName;
  }
  return null;
}

type NoteSaveTarget = "item" | "standalone";

function createToolRegistry(): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  const zoteroGateway = new ZoteroGateway();
  const pdfService = new PdfService();
  const retrievalService = new RetrievalService(pdfService);

  const readTool = <TInput, TResult>(
    tool: AgentToolDefinition<TInput, TResult>,
  ) => registry.register(tool);

  readTool({
    spec: {
      name: "get_active_context",
      description:
        "Return the current Zotero paper context, selected text, attachments, and active reader metadata.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: () => ok({}),
    execute: async (_input, context) => {
      const activeItem =
        zoteroGateway.getItem(context.request.activeItemId) || context.item;
      const activeContextItem = zoteroGateway.getActiveContextItem(activeItem);
      const activePaperContext = zoteroGateway.getActivePaperContext(activeItem);
      return {
        activeItemId: activeItem?.id,
        activeContextItemId: activeContextItem?.id,
        activePaperContext,
        selectedTexts: context.request.selectedTexts || [],
        selectedPaperContexts: context.request.selectedPaperContexts || [],
        pinnedPaperContexts: context.request.pinnedPaperContexts || [],
        attachments:
          context.request.attachments?.map((entry) => ({
            id: entry.id,
            name: entry.name,
            mimeType: entry.mimeType,
            sizeBytes: entry.sizeBytes,
            category: entry.category,
          })) || [],
      };
    },
  });

  readTool({
    spec: {
      name: "list_paper_contexts",
      description:
        "List current paper references available to the agent, including selected, pinned, and active paper context.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: () => ok({}),
    execute: async (_input, context) => ({
      papers: zoteroGateway.listPaperContexts(context.request),
    }),
  });

  readTool({
    spec: {
      name: "retrieve_paper_evidence",
      description:
        "Retrieve ranked paper evidence chunks for the current question from the active, selected, or specified papers.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          paperContext: {
            type: "object",
            properties: {
              itemId: { type: "number" },
              contextItemId: { type: "number" },
              title: { type: "string" },
            },
          },
          topK: { type: "number" },
          perPaperTopK: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (args === undefined) return ok<Record<string, unknown>>({});
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail<Record<string, unknown>>("Expected an object");
      }
      return ok<Record<string, unknown>>(args);
    },
    execute: async (input: Record<string, unknown>, context) => {
      const explicitPaper = validateObject<Record<string, unknown>>(input)
        ? normalizeToolPaperContext(input.paperContext as Record<string, unknown>)
        : null;
      const papers = explicitPaper
        ? [explicitPaper]
        : zoteroGateway.listPaperContexts(context.request);
      const question =
        validateObject<Record<string, unknown>>(input) &&
        typeof input.question === "string" &&
        input.question.trim()
          ? input.question.trim()
          : context.request.userText;
      const topK =
        validateObject<Record<string, unknown>>(input)
          ? normalizePositiveInt(input.topK)
          : undefined;
      const perPaperTopK =
        validateObject<Record<string, unknown>>(input)
          ? normalizePositiveInt(input.perPaperTopK)
          : undefined;
      return {
        evidence: await retrievalService.retrieveEvidence({
          papers,
          question,
          apiBase: context.request.apiBase,
          apiKey: context.request.apiKey,
          topK,
          perPaperTopK,
        }),
      };
    },
  });

  readTool({
    spec: {
      name: "read_paper_excerpt",
      description:
        "Read a specific chunk of PDF text for a given paper context and chunk index.",
      inputSchema: {
        type: "object",
        required: ["paperContext", "chunkIndex"],
        additionalProperties: false,
        properties: {
          paperContext: {
            type: "object",
            required: ["itemId", "contextItemId"],
            properties: {
              itemId: { type: "number" },
              contextItemId: { type: "number" },
              title: { type: "string" },
            },
          },
          chunkIndex: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      const paperContext = normalizeToolPaperContext(
        args.paperContext as Record<string, unknown>,
      );
      const chunkIndex = normalizePositiveInt(args.chunkIndex);
      if (!paperContext || chunkIndex === undefined) {
        return fail("paperContext and chunkIndex are required");
      }
      return ok({
        paperContext,
        chunkIndex,
      });
    },
    execute: async (input: {
      paperContext: PaperContextRef;
      chunkIndex: number;
    }) => pdfService.getChunkExcerpt(input),
  });

  readTool({
    spec: {
      name: "search_library_items",
      description:
        "Search library papers by title, citation key, author, year, DOI, or attachment title.",
      inputSchema: {
        type: "object",
        required: ["query"],
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail<{ query: string; limit?: number }>("Expected an object");
      }
      if (typeof args.query !== "string" || !args.query.trim()) {
        return fail<{ query: string; limit?: number }>("query is required");
      }
      return ok<{
        query: string;
        limit?: number;
      }>({
        query: args.query.trim(),
        limit: normalizePositiveInt(args.limit),
      });
    },
    execute: async (
      input: {
        query: string;
        limit?: number;
      },
      context,
    ) => {
      const item =
        zoteroGateway.getItem(context.request.activeItemId) || context.item;
      const libraryID =
        item?.libraryID ||
        (Number.isFinite(context.request.libraryID)
          ? Math.floor(context.request.libraryID as number)
          : 0);
      if (!libraryID) {
        throw new Error("No active library available for search");
      }
      return {
        results: await zoteroGateway.searchLibraryItems({
          libraryID,
          query: input.query,
          excludeContextItemId:
            zoteroGateway.getActiveContextItem(item)?.id || null,
          limit: input.limit,
        }),
      };
    },
  });

  readTool({
    spec: {
      name: "read_attachment_text",
      description:
        "Read extracted text content from one of the currently attached non-image files.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          attachmentId: { type: "string" },
          name: { type: "string" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail<{ attachmentId?: string; name?: string }>(
          "Expected an object",
        );
      }
      const attachmentId =
        typeof args.attachmentId === "string" && args.attachmentId.trim()
          ? args.attachmentId.trim()
          : undefined;
      const name =
        typeof args.name === "string" && args.name.trim()
          ? args.name.trim()
          : undefined;
      if (!attachmentId && !name) {
        return fail<{ attachmentId?: string; name?: string }>(
          "attachmentId or name is required",
        );
      }
      return ok<{
        attachmentId?: string;
        name?: string;
      }>({
        attachmentId,
        name,
      });
    },
    execute: async (
      input: {
        attachmentId?: string;
        name?: string;
      },
      context,
    ) => {
      const attachment = findAttachment(context.request.attachments, input);
      if (!attachment) {
        throw new Error("Attachment not found in the current request");
      }
      return {
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        textContent: attachment.textContent || "",
      };
    },
  });

  registry.register({
    spec: {
      name: "save_answer_to_note",
      description:
        "Save a piece of assistant-authored content into a Zotero note for the active paper after user confirmation.",
      inputSchema: {
        type: "object",
        required: ["content"],
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          modelName: { type: "string" },
          target: {
            type: "string",
            enum: ["item", "standalone"],
          },
        },
      },
      mutability: "write",
      requiresConfirmation: true,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      if (typeof args.content !== "string" || !args.content.trim()) {
        return fail("content is required");
      }
      return ok({
        content: args.content.trim(),
        modelName:
          typeof args.modelName === "string" && args.modelName.trim()
            ? args.modelName.trim()
            : undefined,
        target:
          args.target === "standalone" || args.target === "item"
            ? (args.target as NoteSaveTarget)
            : undefined,
      });
    },
    createPendingWriteAction: (input: {
      content: string;
      modelName?: string;
      target?: NoteSaveTarget;
    }, context) => {
      const isPaperChat = Boolean(context.item && !isGlobalPortalItem(context.item));
      const saveTargets = isPaperChat
        ? [
            { id: "item", label: "Save as item note" },
            { id: "standalone", label: "Save as standalone note" },
          ]
        : [{ id: "standalone", label: "Save as standalone note" }];
      return {
        toolName: "save_answer_to_note",
        args: input,
        title: "Review note content",
        confirmLabel: saveTargets[0]?.label || "Save note",
        cancelLabel: "Cancel",
        editableContent: input.content,
        contentLabel: "Note content",
        saveTargets,
        defaultTargetId:
          input.target ||
          (isPaperChat ? "item" : "standalone"),
      };
    },
    applyConfirmation: (
      input: {
        content: string;
        modelName?: string;
        target?: NoteSaveTarget;
      },
      resolutionData: unknown,
    ) => {
      if (!validateObject<Record<string, unknown>>(resolutionData)) {
        return ok(input);
      }
      const content =
        typeof resolutionData.content === "string" &&
        resolutionData.content.trim()
          ? resolutionData.content.trim()
          : input.content;
      const target =
        resolutionData.target === "standalone" ||
        resolutionData.target === "item"
          ? (resolutionData.target as NoteSaveTarget)
          : input.target;
      if (!content) {
        return fail("content is required");
      }
      return ok({
        ...input,
        content,
        target,
      });
    },
    execute: async (
      input: {
        content: string;
        modelName?: string;
        target?: NoteSaveTarget;
      },
      context,
    ) => {
      const item =
        zoteroGateway.getItem(context.request.activeItemId) || context.item;
      const result = await zoteroGateway.saveAnswerToNote({
        item,
        libraryID: context.request.libraryID,
        content: input.content,
        modelName: input.modelName || context.modelName,
        target: input.target,
      });
      return {
        status: result,
      };
    },
  });

  return registry;
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
