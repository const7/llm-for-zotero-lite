import type {
  AgentModelMessage,
  AgentRuntimeRequest,
  AgentToolDefinition,
} from "../types";

export function isMultimodalRequestSupported(
  request: AgentRuntimeRequest,
): boolean {
  const model = (request.model || "").trim().toLowerCase();
  if (!model) return true;
  return !(
    model.includes("reasoner") ||
    model.includes("text-only") ||
    model.includes("embedding")
  );
}

export function stringifyMessageContent(
  content: AgentModelMessage["content"],
): string {
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
      content: stringifyMessageContent(message.content),
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
  if (
    Array.isArray(request.selectedPaperContexts) &&
    request.selectedPaperContexts.length
  ) {
    contextLines.push(
      "Selected paper refs:",
      ...request.selectedPaperContexts.map(
        (entry, index) =>
          `- Selected paper ${index + 1}: ${entry.title} [itemId=${entry.itemId}, contextItemId=${entry.contextItemId}]`,
      ),
    );
  }
  if (
    Array.isArray(request.pinnedPaperContexts) &&
    request.pinnedPaperContexts.length
  ) {
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
      "Current uploaded attachments are available through the registered document tools.",
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

function collectGuidanceInstructions(
  request: AgentRuntimeRequest,
  tools: AgentToolDefinition<any, any>[],
): string[] {
  const instructions = new Set<string>();
  for (const tool of tools) {
    const guidance = tool.guidance;
    if (!guidance) continue;
    if (!guidance.matches(request)) continue;
    const instruction = guidance.instruction.trim();
    if (instruction) {
      instructions.add(instruction);
    }
  }
  return Array.from(instructions);
}

export function buildAgentInitialMessages(
  request: AgentRuntimeRequest,
  tools: AgentToolDefinition<any, any>[],
): AgentModelMessage[] {
  const systemPrompt = [
    (request.systemPrompt || "").trim(),
    "You are the agent runtime inside a Zotero plugin.",
    "Use tools for paper/library/document operations instead of claiming hidden access.",
    "If a write action is needed, call the write tool and wait for confirmation.",
    "If a write tool can collect missing choices in its confirmation UI, call that write tool directly instead of asking a follow-up chat question.",
    "If read tools were used to plan a write action that the user asked you to perform, call the relevant write tool next instead of stopping with a chat summary.",
    "When enough evidence has been collected, answer clearly and concisely.",
    ...collectGuidanceInstructions(request, tools),
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
