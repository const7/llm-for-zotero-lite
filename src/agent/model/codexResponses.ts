import { RESPONSES_ENDPOINT, resolveEndpoint } from "../../utils/apiHelpers";
import {
  postWithReasoningFallback,
  resolveRequestAuthState,
} from "../../utils/llmClient";
import type {
  AgentModelCapabilities,
  AgentModelMessage,
  AgentModelStep,
  AgentRuntimeRequest,
  AgentToolCall,
  ToolSpec,
} from "../types";
import type { AgentModelAdapter, AgentStepParams } from "./adapter";
import {
  isMultimodalRequestSupported,
  stringifyMessageContent,
} from "./messageBuilder";

type ResponsesInputItem =
  | {
      type: "message";
      role: "system" | "user" | "assistant";
      content:
        | string
        | Array<
            | { type: "input_text"; text: string }
            | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" }
          >;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

type ResponsesOutputContent = {
  type?: unknown;
  text?: unknown;
};

type ResponsesOutputItem = {
  id?: unknown;
  type?: unknown;
  call_id?: unknown;
  name?: unknown;
  arguments?: unknown;
  text?: unknown;
  content?: unknown;
};

type ResponsesPayload = {
  id?: unknown;
  output_text?: unknown;
  output?: unknown;
};

type NormalizedResponsesStep = {
  responseId?: string;
  text: string;
  toolCalls: AgentToolCall[];
  outputItems: unknown[];
};

function isCodexAuthRequest(request: AgentRuntimeRequest): boolean {
  return (
    request.authMode === "codex_auth" ||
    /chatgpt\.com\/backend-api\/codex\/responses/i.test(
      (request.apiBase || "").trim(),
    )
  );
}

function buildResponsesInput(
  messages: AgentModelMessage[],
): { instructions?: string; input: ResponsesInputItem[] } {
  const instructionsParts: string[] = [];
  const input: ResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role === "system") {
      const text = stringifyMessageContent(message.content);
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
    input.push({
      type: "message",
      role: message.role,
      content: message.content.map((part) => {
        if (part.type === "text") {
          return { type: "input_text" as const, text: part.text };
        }
        if (part.type === "image_url") {
          return {
            type: "input_image" as const,
            image_url: part.image_url.url,
            detail: part.image_url.detail,
          };
        }
        return {
          type: "input_text" as const,
          text: `[Prepared file: ${part.file_ref.name}]`,
        };
      }),
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

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).join("");
  }
  if (value && typeof value === "object") {
    const row = value as { text?: unknown; content?: unknown };
    return normalizeText(row.text) || normalizeText(row.content);
  }
  return "";
}

function extractOutputTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const row = entry as ResponsesOutputContent;
      const typeValue =
        typeof row.type === "string" ? row.type.toLowerCase() : "";
      if (typeValue && typeValue !== "output_text" && typeValue !== "text") {
        return "";
      }
      return normalizeText(row.text);
    })
    .filter(Boolean)
    .join("");
}

function parseToolCallArguments(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return { raw };
  }
}

function extractToolCallsFromOutputs(outputs: unknown): AgentToolCall[] {
  if (!Array.isArray(outputs)) return [];
  const calls: AgentToolCall[] = [];
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index];
    if (!output || typeof output !== "object") continue;
    const row = output as ResponsesOutputItem;
    const typeValue =
      typeof row.type === "string" ? row.type.toLowerCase() : "";
    if (typeValue !== "function_call") continue;
    const name =
      typeof row.name === "string" && row.name.trim() ? row.name.trim() : "";
    if (!name) continue;
    const callId =
      typeof row.call_id === "string" && row.call_id.trim()
        ? row.call_id.trim()
        : typeof row.id === "string" && row.id.trim()
          ? row.id.trim()
          : `tool-${Date.now()}-${index}`;
    calls.push({
      id: callId,
      name,
      arguments: parseToolCallArguments(row.arguments),
    });
  }
  return calls;
}

function extractOutputText(outputs: unknown): string {
  if (!Array.isArray(outputs)) return "";
  return outputs
    .map((output) => {
      if (!output || typeof output !== "object") return "";
      const row = output as ResponsesOutputItem;
      const typeValue =
        typeof row.type === "string" ? row.type.toLowerCase() : "";
      if (typeValue === "function_call") return "";
      return extractOutputTextFromContent(row.content) || normalizeText(row.text);
    })
    .filter(Boolean)
    .join("");
}

export function normalizeStepFromPayload(
  data: ResponsesPayload,
): NormalizedResponsesStep {
  const outputs = Array.isArray(data.output) ? data.output : [];
  const responseId =
    typeof data.id === "string" && data.id.trim() ? data.id.trim() : undefined;
  const toolCalls = extractToolCallsFromOutputs(outputs);
  const text =
    normalizeText(data.output_text).trim() || extractOutputText(outputs).trim();
  return {
    responseId,
    text,
    toolCalls,
    outputItems: outputs,
  };
}

async function parseResponsesStepStream(
  stream: ReadableStream<Uint8Array>,
): Promise<NormalizedResponsesStep> {
  const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = "";
  let responseId: string | undefined;
  let latestPayload: ResponsesPayload | null = null;
  let streamedText = "";
  const streamedOutputs: ResponsesOutputItem[] = [];

  const mergeOutputItem = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    streamedOutputs.push(item as ResponsesOutputItem);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            type?: unknown;
            delta?: unknown;
            text?: unknown;
            item?: unknown;
            response?: ResponsesPayload;
          };
          const eventType =
            typeof parsed.type === "string" ? parsed.type.toLowerCase() : "";
          if (eventType === "response.output_text.delta") {
            streamedText += normalizeText(parsed.delta);
            continue;
          }
          if (
            eventType === "response.output_item.added" ||
            eventType === "response.output_item.done"
          ) {
            mergeOutputItem(parsed.item);
            continue;
          }
          if (eventType === "response.completed" && parsed.response) {
            latestPayload = parsed.response;
            if (
              typeof parsed.response.id === "string" &&
              parsed.response.id.trim()
            ) {
              responseId = parsed.response.id.trim();
            }
            continue;
          }
        } catch (_error) {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (latestPayload) {
    const normalized = normalizeStepFromPayload(latestPayload);
    return {
      responseId: normalized.responseId || responseId,
      text: normalized.text || streamedText.trim(),
      toolCalls: normalized.toolCalls,
      outputItems: normalized.outputItems,
    };
  }

  const toolCalls = extractToolCallsFromOutputs(streamedOutputs);
  return {
    responseId,
    text: streamedText.trim() || extractOutputText(streamedOutputs).trim(),
    toolCalls,
    outputItems: streamedOutputs,
  };
}

export class CodexResponsesAgentAdapter implements AgentModelAdapter {
  private conversationItems: unknown[] | null = null;

  getCapabilities(request: AgentRuntimeRequest): AgentModelCapabilities {
    return {
      streaming: false,
      toolCalls: isCodexAuthRequest(request),
      multimodal: isMultimodalRequestSupported(request),
    };
  }

  supportsTools(request: AgentRuntimeRequest): boolean {
    return this.getCapabilities(request).toolCalls;
  }

  async runStep(params: AgentStepParams): Promise<AgentModelStep> {
    const request = params.request;
    const auth = await resolveRequestAuthState({
      authMode: request.authMode || "api_key",
      apiKey: request.apiKey || "",
      signal: params.signal,
    });
    const initialInput = buildResponsesInput(params.messages);
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
      stream: true,
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

    const normalized = response.body
      ? await parseResponsesStepStream(response.body)
      : normalizeStepFromPayload((await response.json()) as ResponsesPayload);

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
