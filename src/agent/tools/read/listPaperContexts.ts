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
    presentation: {
      label: "List Papers",
      summaries: {
        onCall: "Reviewing the papers currently in scope",
        onSuccess: ({ content }) => {
          const papers =
            content &&
            typeof content === "object" &&
            Array.isArray((content as { papers?: unknown }).papers)
              ? (content as { papers: unknown[] }).papers
              : [];
          return papers.length > 0
            ? `Confirmed ${papers.length} paper${
                papers.length === 1 ? "" : "s"
              } in scope`
            : "No paper context is currently in scope";
        },
      },
    },
    validate: () => ok({}),
    execute: async (_input, context) => ({
      papers: zoteroGateway.listPaperContexts(context.request),
    }),
  };
}
