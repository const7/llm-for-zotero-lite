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
