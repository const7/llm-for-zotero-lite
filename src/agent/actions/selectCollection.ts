import type { AgentAction, ActionExecutionContext, ActionResult } from "./types";

type SelectCollectionInput = Record<string, never>;
type SelectCollectionOutput = { selected: boolean };

/**
 * UI-driven action that opens the collection picker in library chat mode.
 * The actual picker logic is handled by the UI layer (setupHandlers.ts);
 * this stub exists so the action appears in the agent actions slash menu.
 */
export const selectCollectionAction: AgentAction<SelectCollectionInput, SelectCollectionOutput> = {
  name: "select_collection",
  modes: ["library"],
  description: "Add a Zotero collection as context for the conversation.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },

  async execute(
    _input: SelectCollectionInput,
    _ctx: ActionExecutionContext,
  ): Promise<ActionResult<SelectCollectionOutput>> {
    // Execution is handled by the UI layer (collection picker).
    return { ok: true, output: { selected: false } };
  },
};
