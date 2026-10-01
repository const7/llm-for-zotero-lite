import { readCodexModels, resolveCodexEffort } from "./models";
import type {
  ChatMessage,
  ReasoningConfig,
  ReasoningEvent,
  UsageStats,
} from "../utils/llmClient";
import { CodexRpc, type CodexProcess } from "./rpc";
import { spawnCodex } from "./process";

type CodexChatRequest = {
  model: string;
  messages: ChatMessage[];
  reasoning?: ReasoningConfig;
  signal?: AbortSignal;
  onDelta(delta: string): void;
  onReasoning?(event: ReasoningEvent): void;
  onUsage?(usage: UsageStats): void;
};

const active = new Set<CodexRpc>();
let shutdownGeneration = 0;
export function stopCodexRequests(): void {
  shutdownGeneration += 1;
  for (const rpc of active) rpc.close(new Error("Plugin shutdown"));
  active.clear();
}

export function buildCodexInput(messages: ChatMessage[]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
    )
    .join("\n\n");
  const turns = messages.filter((message) => message.role !== "system");
  const current = turns.pop();
  if (!current || current.role !== "user")
    throw new Error("Codex needs a final user message.");
  const history = turns.map((message) => ({
    type: "message",
    role: message.role,
    content:
      typeof message.content === "string"
        ? [
            {
              type: message.role === "assistant" ? "output_text" : "input_text",
              text: message.content,
            },
          ]
        : message.content.map((part) =>
            part.type === "text"
              ? { type: "input_text", text: part.text }
              : { type: "input_image", image_url: part.image_url.url },
          ),
  }));
  const input =
    typeof current.content === "string"
      ? [{ type: "text", text: current.content, text_elements: [] }]
      : current.content.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text, text_elements: [] }
            : { type: "image", url: part.image_url.url },
        );
  return { instructions, history, input };
}

export async function runCodexChat(
  params: CodexChatRequest,
  spawn: () => Promise<CodexProcess> = spawnCodex,
): Promise<string> {
  const abortError = () =>
    Object.assign(new Error("Cancelled"), { name: "AbortError" });
  if (params.signal?.aborted) throw abortError();
  const { instructions, history, input } = buildCodexInput(params.messages);
  const generation = shutdownGeneration;
  const rpc = new CodexRpc(await spawn());
  active.add(rpc);
  let threadId = "";
  const answers = new Map<string, string>();
  let usage: UsageStats | undefined;
  let resolveTurn!: () => void;
  let rejectTurn!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  // Setup failures can precede awaiting the turn promise.
  void completed.catch(() => {});
  rpc.onClose = rejectTurn;
  const cancel = () => rpc.close(abortError());
  params.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(
    () => rpc.close(new Error("Codex response timed out.")),
    15 * 60_000,
  );
  rpc.onNotification = (method, event) => {
    if (!threadId || event?.threadId !== threadId) return;
    if (method === "item/agentMessage/delta") {
      answers.set(
        event.itemId,
        (answers.get(event.itemId) || "") + event.delta,
      );
      params.onDelta(event.delta);
    } else if (
      method === "item/completed" &&
      event.item?.type === "agentMessage"
    ) {
      const previous = answers.get(event.item.id) || "";
      const text = event.item.text as string;
      if (text.startsWith(previous) && text.length > previous.length)
        params.onDelta(text.slice(previous.length));
      answers.set(event.item.id, text);
    } else if (method === "item/reasoning/summaryTextDelta") {
      params.onReasoning?.({ summary: event.delta });
    } else if (method === "thread/tokenUsage/updated") {
      const total = event.tokenUsage.total;
      usage = {
        promptTokens: total.inputTokens,
        completionTokens: total.outputTokens,
        totalTokens: total.totalTokens,
      };
    } else if (method === "turn/completed") {
      if (event.turn.status === "completed") resolveTurn();
      else
        rejectTurn(
          new Error(
            event.turn.error?.message || `Codex turn ${event.turn.status}`,
          ),
        );
    }
  };
  try {
    if (generation !== shutdownGeneration) throw new Error("Plugin shutdown");
    if (params.signal?.aborted) throw abortError();
    await rpc.request("initialize", {
      clientInfo: { name: "llm-for-zotero-lite", version: "1.0" },
      capabilities: { experimentalApi: true },
    });
    await rpc.notify("initialized");
    const models = await readCodexModels(rpc);
    const model = models.find((entry) => entry.model === params.model);
    if (!model)
      throw new Error(
        `Codex model is not available: ${params.model}. Refresh models in Settings.`,
      );
    const effort = resolveCodexEffort(model, params.reasoning?.level);
    if (!effort)
      throw new Error(
        `Codex model does not support low, medium or high reasoning: ${params.model}`,
      );
    const configuration = await rpc.request("config/read", {
      includeLayers: false,
    });
    const mcpServers = Object.fromEntries(
      Object.keys(configuration.config?.mcp_servers || {}).map((name) => [
        name,
        { enabled: false },
      ]),
    );
    const result = await rpc.request("thread/start", {
      model: params.model,
      config: { mcp_servers: mcpServers },
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: instructions,
      developerInstructions:
        "Answer the user's paper question using the supplied context. Do not use tools or inspect local files.",
    });
    // Never silently downgrade to a persistent thread on an older server.
    if (result.thread?.ephemeral !== true || !result.thread?.id)
      throw new Error(
        "Codex did not confirm an ephemeral thread. Update the Codex CLI.",
      );
    threadId = result.thread.id;
    if (history.length)
      await rpc.request("thread/inject_items", { threadId, items: history });
    await rpc.request("turn/start", {
      threadId,
      input,
      effort,
      summary: "auto",
    });
    await completed;
    const answer = [...answers.values()].join("\n\n").trim();
    if (!answer) throw new Error("Codex completed without an answer.");
    if (usage) params.onUsage?.(usage);
    return answer;
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", cancel);
    active.delete(rpc);
    rpc.close();
  }
}
