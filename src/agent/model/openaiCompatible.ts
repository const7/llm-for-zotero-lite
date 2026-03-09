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
import { isMultimodalRequestSupported } from "./messageBuilder";

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
}
