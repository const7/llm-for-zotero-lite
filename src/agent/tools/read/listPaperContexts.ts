import type { AgentToolDefinition } from "../../types";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import { ok } from "../shared";

export function createListPaperContextsTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<{}, unknown> {
  return {
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
  };
}
