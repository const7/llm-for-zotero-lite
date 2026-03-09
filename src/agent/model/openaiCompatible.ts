import { API_ENDPOINT, resolveEndpoint, usesMaxCompletionTokens } from "../../utils/apiHelpers";
import { normalizeMaxTokens, normalizeTemperature } from "../../utils/normalization";
import type {
  AgentModelCapabilities,
  AgentModelMessage,
  AgentModelStep,
  AgentRuntimeRequest,
  AgentToolCall,
  ToolSpec,
} from "../types";
import type { AgentModelAdapter, AgentStepParams } from "./adapter";

type ChatCompletionChoice = {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
};

function getFetch(): typeof fetch {
  return ztoolkit.getGlobal("fetch") as typeof fetch;
}

function isToolCapableApiBase(request: AgentRuntimeRequest): boolean {
  const apiBase = (request.apiBase || "").trim();
  if (!apiBase) return false;
  if (request.authMode === "codex_auth") return false;
  const endpoint = resolveEndpoint(apiBase, API_ENDPOINT);
  if (!endpoint) return false;
  if (/chatgpt\.com\/backend-api\/codex\/responses/i.test(endpoint)) {
    return false;
  }
  return true;
}

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
    "Only fall back to lower-level metadata tools such as search_library_items or read_paper_front_matter yourself when audit_article_metadata is inconclusive and you still need more evidence.",
    "Only ask a follow-up if the target article is ambiguous or you truly cannot infer a safe metadata correction.",
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
    "Only use prepare_pdf_file_for_model when the user explicitly asks to inspect the entire PDF or whole document.",
  ].join("\n");
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
    const paperLines = request.selectedPaperContexts.map(
      (entry, index) =>
        `- Selected paper ${index + 1}: ${entry.title} [itemId=${entry.itemId}, contextItemId=${entry.contextItemId}]`,
    );
    contextLines.push("Selected paper refs:", ...paperLines);
  }
  if (Array.isArray(request.pinnedPaperContexts) && request.pinnedPaperContexts.length) {
    const paperLines = request.pinnedPaperContexts.map(
      (entry, index) =>
        `- Pinned paper ${index + 1}: ${entry.title} [itemId=${entry.itemId}, contextItemId=${entry.contextItemId}]`,
    );
    contextLines.push("Pinned paper refs:", ...paperLines);
  }
  if (Array.isArray(request.attachments) && request.attachments.length) {
    contextLines.push(
      "Current uploaded attachments are available through the read_attachment_text tool.",
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
      {
        type: "text",
        text: promptText,
      },
      ...screenshots.map((url) => ({
        type: "image_url" as const,
        image_url: {
          url,
        },
      })),
    ],
  };
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
      content: stringifyContent(message.content as string),
    }));
}

function buildMessages(request: AgentRuntimeRequest): AgentModelMessage[] {
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
  const messages: AgentModelMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...normalizeHistoryMessages(request),
    buildUserMessage(request),
  ];
  return messages;
}

function buildTools(tools: ToolSpec[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function buildMessagesPayload(messages: AgentModelMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.tool_call_id,
        name: message.name,
      };
    }
    return {
      role: message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type !== "file_ref")
              .map((part) =>
                part.type === "text"
                  ? part
                  : {
                      type: "image_url" as const,
                      image_url: part.image_url,
                    },
              ),
      ...(message.role === "assistant" &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length
        ? {
            tool_calls: message.tool_calls.map((call: AgentToolCall) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments ?? {}),
              },
            })),
          }
        : {}),
    };
  });
}

function parseToolCallArguments(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return { raw };
  }
}

function normalizeToolCalls(
  toolCalls:
    | Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>
    | undefined,
): AgentToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((call, index) => {
      const name = call?.function?.name?.trim();
      if (!name) return null;
      return {
        id: call?.id?.trim() || `tool-${Date.now()}-${index}`,
        name,
        arguments: parseToolCallArguments(call?.function?.arguments),
      };
    })
    .filter((call): call is AgentToolCall => Boolean(call));
}

export class OpenAICompatibleAgentAdapter implements AgentModelAdapter {
  getCapabilities(request: AgentRuntimeRequest): AgentModelCapabilities {
    return {
      streaming: false,
      toolCalls: isToolCapableApiBase(request),
      multimodal: isMultimodalRequestSupported(request),
    };
  }

  supportsTools(request: AgentRuntimeRequest): boolean {
    return this.getCapabilities(request).toolCalls;
  }

  async runStep(params: AgentStepParams): Promise<AgentModelStep> {
    const payload = {
      model: params.request.model,
      messages: buildMessagesPayload(params.messages),
      tools: buildTools(params.tools),
      tool_choice: "auto",
      ...(usesMaxCompletionTokens(params.request.model || "")
        ? {
            max_completion_tokens: normalizeMaxTokens(
              params.request.advanced?.maxTokens,
            ),
          }
        : {
            max_tokens: normalizeMaxTokens(params.request.advanced?.maxTokens),
          }),
      temperature: normalizeTemperature(params.request.advanced?.temperature),
    };
    const url = resolveEndpoint(params.request.apiBase || "", API_ENDPOINT);
    const response = await getFetch()(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.request.apiKey
          ? { Authorization: `Bearer ${params.request.apiKey}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: params.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${response.status} ${response.statusText} - ${errorText}`,
      );
    }
    const data = (await response.json()) as { choices?: ChatCompletionChoice[] };
    const message = data.choices?.[0]?.message;
    const toolCalls = normalizeToolCalls(message?.tool_calls);
    if (toolCalls.length) {
      return {
        kind: "tool_calls",
        calls: toolCalls,
        assistantMessage: {
          role: "assistant",
          content: typeof message?.content === "string" ? message.content : "",
          tool_calls: toolCalls,
        },
      };
    }
    return {
      kind: "final",
      text: typeof message?.content === "string" ? message.content : "",
      assistantMessage: {
        role: "assistant",
        content: typeof message?.content === "string" ? message.content : "",
      },
    };
  }

  buildInitialMessages(request: AgentRuntimeRequest): AgentModelMessage[] {
    return buildMessages(request);
  }
}
