import { RESPONSES_ENDPOINT, resolveEndpoint } from "../../utils/apiHelpers";
import {
  postWithReasoningFallback,
  resolveRequestAuthState,
  uploadFilesForResponses,
  type ChatFileAttachment,
} from "../../utils/llmClient";
import type {
  AgentModelCapabilities,
  AgentModelContentPart,
  AgentModelMessage,
  AgentModelStep,
  AgentRuntimeRequest,
  AgentToolCall,
  ToolSpec,
} from "../types";
import type { AgentModelAdapter, AgentStepParams } from "./adapter";
import { normalizeStepFromPayload } from "./codexResponses";

type ResponsesInputItem =
  | {
      type: "message";
      role: "system" | "user" | "assistant";
      content:
        | string
        | Array<
            | { type: "input_text"; text: string }
            | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" }
            | { type: "input_file"; file_id: string }
          >;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

type ResponsesPayload = {
  id?: unknown;
  output_text?: unknown;
  output?: unknown;
};

function isMultimodalRequestSupported(request: AgentRuntimeRequest): boolean {
  const model = (request.model || "").trim().toLowerCase();
  if (!model) return true;
  return !(
    model.includes("reasoner") ||
    model.includes("text-only") ||
    model.includes("embedding")
  );
}

function getMetadataEditDirective(userText: string): string {
  const normalized = userText.trim().toLowerCase();
  const looksLikeMetadataTask =
    /\bmetadata\b/.test(normalized) ||
    /\b(doi|title|abstract|journal|authors?|creator|date|pages|volume|issue|url|isbn|issn|publisher)\b/.test(
      normalized,
    ) &&
      /\b(fix|edit|correct|clean|standardi[sz]e|complete|update|fill|repair)\b/.test(
        normalized,
      );
  if (!looksLikeMetadataTask) return "";
  return [
    "When the user asks to fix, clean up, standardize, or complete article metadata, do not default to a follow-up conversation.",
    "Treat metadata fixing as a full audit, not a spot edit. Review all supported metadata fields, especially creators/authors, title, venue, date, pages, DOI, URL, ISSN/ISBN, abstract, language, and extra.",
    "Start by inspecting the current article metadata. If any field is missing, incomplete, inconsistent, or likely non-standard, gather stronger evidence before editing.",
    "Use audit_article_metadata first. It compares the current item against matching library metadata and paper front matter, and it returns a suggestedPatch plus field-by-field reasons, including creator-list issues.",
    "Treat suggestedPatch from audit_article_metadata as the high-confidence subset. If it is non-empty, pass it directly into edit_article_metadata, either as patch or suggestedPatch, so the user can review the proposed change set.",
  ].join("\n");
}

function getPdfVisualDirective(request: AgentRuntimeRequest): string {
  const normalized = (request.userText || "").trim().toLowerCase();
  const looksLikePdfVisualTask =
    /\b(pdf|figure|equation|table|diagram|chart|graph|panel|page|layout)\b/.test(
      normalized,
    ) ||
    (Array.isArray(request.screenshots) && request.screenshots.some(Boolean));
  if (!looksLikePdfVisualTask) return "";
  return [
    "When the user asks about a figure, equation, table, page layout, or any PDF-specific visual detail, use the PDF tools instead of guessing from text alone.",
    "Start with search_pdf_pages to find relevant pages.",
    "Use prepare_pdf_pages_for_model to send selected PDF pages as images for visual inspection.",
    "If the user explicitly names page numbers, you may send those pages directly.",
    "If the pages are auto-selected by the tool, wait for approval before sending them.",
    "Only use prepare_pdf_file_for_model when the user explicitly asks to inspect the entire PDF or whole document. Do not send a whole PDF by default.",
  ].join("\n");
}

function stringifyContent(content: AgentModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : part.type === "image_url"
          ? "[image]"
          : "[file]",
    )
    .join("\n");
}

function normalizeHistoryMessages(
  request: AgentRuntimeRequest,
): AgentModelMessage[] {
  const history = Array.isArray(request.history) ? request.history.slice(-8) : [];
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: stringifyContent(message.content),
    }));
}

function buildUserMessage(request: AgentRuntimeRequest): AgentModelMessage {
  const contextLines: string[] = [
    "Current Zotero context summary:",
    `- Conversation key: ${request.conversationKey}`,
  ];
  if (Array.isArray(request.selectedTexts) && request.selectedTexts.length) {
    const selectedTextBlock = request.selectedTexts
      .map((entry, index) => `Selected text ${index + 1}:\n"""\n${entry}\n"""`)
      .join("\n\n");
    contextLines.push(selectedTextBlock);
  }
  if (Array.isArray(request.selectedPaperContexts) && request.selectedPaperContexts.length) {
    contextLines.push(
      "Selected paper refs:",
      ...request.selectedPaperContexts.map(
        (entry, index) =>
          `- Selected paper ${index + 1}: ${entry.title} [itemId=${entry.itemId}, contextItemId=${entry.contextItemId}]`,
      ),
    );
  }
  if (Array.isArray(request.pinnedPaperContexts) && request.pinnedPaperContexts.length) {
    contextLines.push(
      "Pinned paper refs:",
      ...request.pinnedPaperContexts.map(
        (entry, index) =>
          `- Pinned paper ${index + 1}: ${entry.title} [itemId=${entry.itemId}, contextItemId=${entry.contextItemId}]`,
      ),
    );
  }
  if (Array.isArray(request.attachments) && request.attachments.length) {
    contextLines.push(
      "Current uploaded attachments are available through read_attachment_text, search_pdf_pages, and prepare_pdf_file_for_model when appropriate.",
    );
  }

  const promptText = `${contextLines.join("\n")}\n\nUser request:\n${request.userText}`;
  const screenshots = Array.isArray(request.screenshots)
    ? request.screenshots.filter((entry) => Boolean(entry))
    : [];
  if (!screenshots.length || !isMultimodalRequestSupported(request)) {
    return {
      role: "user",
      content: promptText,
    };
  }
  return {
    role: "user",
    content: [
      { type: "text", text: promptText },
      ...screenshots.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ],
  };
}

function buildInitialMessages(request: AgentRuntimeRequest): AgentModelMessage[] {
  const systemPrompt = [
    (request.systemPrompt || "").trim(),
    "You are the agent runtime inside a Zotero plugin.",
    "Use tools for paper/library/document operations instead of claiming hidden access.",
    "If a write action is needed, call the write tool and wait for confirmation.",
    "When enough evidence has been collected, answer clearly and concisely.",
    getMetadataEditDirective(request.userText || ""),
    getPdfVisualDirective(request),
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    {
      role: "system",
      content: systemPrompt,
    },
    ...normalizeHistoryMessages(request),
    buildUserMessage(request),
  ];
}

async function uploadFilePart(
  part: Extract<AgentModelContentPart, { type: "file_ref" }>,
  request: AgentRuntimeRequest,
  signal?: AbortSignal,
): Promise<string[]> {
  return uploadFilesForResponses({
    apiBase: request.apiBase || "",
    apiKey: request.apiKey || "",
    attachments: [
      {
        name: part.file_ref.name,
        mimeType: part.file_ref.mimeType,
        storedPath: part.file_ref.storedPath,
        contentHash: part.file_ref.contentHash,
      } satisfies ChatFileAttachment,
    ],
    signal,
  });
}

async function buildResponsesInput(
  messages: AgentModelMessage[],
  request: AgentRuntimeRequest,
  signal?: AbortSignal,
): Promise<{ instructions?: string; input: ResponsesInputItem[] }> {
  const instructionsParts: string[] = [];
  const input: ResponsesInputItem[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role === "system") {
      const text = stringifyContent(message.content);
      if (text) instructionsParts.push(text);
      continue;
    }
    if (typeof message.content === "string") {
      input.push({
        type: "message",
        role: message.role,
        content: message.content,
      });
      continue;
    }
    const contentParts: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" }
      | { type: "input_file"; file_id: string }
    > = [];
    for (const part of message.content) {
      if (part.type === "text") {
        contentParts.push({ type: "input_text", text: part.text });
        continue;
      }
      if (part.type === "image_url") {
        contentParts.push({
          type: "input_image",
          image_url: part.image_url.url,
          detail: part.image_url.detail,
        });
        continue;
      }
      const fileIds = await uploadFilePart(part, request, signal);
      for (const fileId of fileIds) {
        contentParts.push({
          type: "input_file",
          file_id: fileId,
        });
      }
    }
    input.push({
      type: "message",
      role: message.role,
      content: contentParts,
    });
  }
  return {
    instructions: instructionsParts.length
      ? instructionsParts.join("\n\n")
      : undefined,
    input,
  };
}

function buildToolOutputInput(messages: AgentModelMessage[]): ResponsesInputItem[] {
  const outputs: ResponsesInputItem[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool") {
      if (outputs.length) break;
      continue;
    }
    outputs.unshift({
      type: "function_call_output",
      call_id: message.tool_call_id,
      output: message.content,
    });
  }
  return outputs;
}

function buildResponsesTools(tools: ToolSpec[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
}

export class OpenAIResponsesAgentAdapter implements AgentModelAdapter {
  private conversationItems: unknown[] | null = null;

  getCapabilities(_request: AgentRuntimeRequest): AgentModelCapabilities {
    return {
      streaming: false,
      toolCalls: true,
      multimodal: true,
    };
  }

  supportsTools(_request: AgentRuntimeRequest): boolean {
    return true;
  }

  buildInitialMessages(request: AgentRuntimeRequest): AgentModelMessage[] {
    return buildInitialMessages(request);
  }

  async runStep(params: AgentStepParams): Promise<AgentModelStep> {
    const request = params.request;
    const auth = await resolveRequestAuthState({
      authMode: request.authMode || "api_key",
      apiKey: request.apiKey || "",
      signal: params.signal,
    });
    const initialInput = await buildResponsesInput(
      params.messages,
      request,
      params.signal,
    );
    const instructions =
      initialInput.instructions?.trim() ||
      "You are the agent runtime inside a Zotero plugin.";
    const followupInput = this.conversationItems
      ? buildToolOutputInput(params.messages)
      : [];
    const inputItems = this.conversationItems
      ? [...this.conversationItems, ...followupInput]
      : initialInput.input;
    const payload = {
      model: request.model,
      instructions,
      input: inputItems,
      tools: buildResponsesTools(params.tools),
      tool_choice: "auto",
      store: false,
      stream: false,
    };
    const url = resolveEndpoint(request.apiBase || "", RESPONSES_ENDPOINT);
    const response = await postWithReasoningFallback({
      url,
      auth,
      modelName: request.model,
      initialReasoning: undefined,
      buildPayload: () => payload,
      signal: params.signal,
    });
    const normalized = normalizeStepFromPayload(
      (await response.json()) as ResponsesPayload,
    );
    this.conversationItems = [...inputItems, ...normalized.outputItems];
    if (normalized.toolCalls.length) {
      return {
        kind: "tool_calls",
        calls: normalized.toolCalls,
        assistantMessage: {
          role: "assistant",
          content: normalized.text,
          tool_calls: normalized.toolCalls,
        },
      };
    }
    return {
      kind: "final",
      text: normalized.text,
      assistantMessage: {
        role: "assistant",
        content: normalized.text,
      },
    };
  }
}
