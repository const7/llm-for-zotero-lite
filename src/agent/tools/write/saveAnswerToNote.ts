import { isGlobalPortalItem } from "../../../modules/contextPanel/portalScope";
import type { AgentToolDefinition } from "../../types";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  fail,
  ok,
  validateObject,
  type NoteSaveTarget,
} from "../shared";

type SaveAnswerToNoteInput = {
  content: string;
  modelName?: string;
  target?: NoteSaveTarget;
};

export function createSaveAnswerToNoteTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<SaveAnswerToNoteInput, unknown> {
  return {
    spec: {
      name: "save_answer_to_note",
      description:
        "Save a piece of assistant-authored content into a Zotero note for the active paper after user confirmation.",
      inputSchema: {
        type: "object",
        required: ["content"],
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          modelName: { type: "string" },
          target: {
            type: "string",
            enum: ["item", "standalone"],
          },
        },
      },
      mutability: "write",
      requiresConfirmation: true,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      if (typeof args.content !== "string" || !args.content.trim()) {
        return fail("content is required");
      }
      return ok({
        content: args.content.trim(),
        modelName:
          typeof args.modelName === "string" && args.modelName.trim()
            ? args.modelName.trim()
            : undefined,
        target:
          args.target === "standalone" || args.target === "item"
            ? (args.target as NoteSaveTarget)
            : undefined,
      });
    },
    createPendingWriteAction: (input, context) => {
      const isPaperChat = Boolean(
        context.item && !isGlobalPortalItem(context.item),
      );
      const saveTargets = isPaperChat
        ? [
            { id: "item", label: "Save as item note" },
            { id: "standalone", label: "Save as standalone note" },
          ]
        : [{ id: "standalone", label: "Save as standalone note" }];
      return {
        toolName: "save_answer_to_note",
        args: input,
        title: "Review note content",
        confirmLabel: saveTargets[0]?.label || "Save note",
        cancelLabel: "Cancel",
        editableContent: input.content,
        contentLabel: "Note content",
        saveTargets,
        defaultTargetId: input.target || (isPaperChat ? "item" : "standalone"),
      };
    },
    applyConfirmation: (input, resolutionData) => {
      if (!validateObject<Record<string, unknown>>(resolutionData)) {
        return ok(input);
      }
      const content =
        typeof resolutionData.content === "string" &&
        resolutionData.content.trim()
          ? resolutionData.content.trim()
          : input.content;
      const target =
        resolutionData.target === "standalone" ||
        resolutionData.target === "item"
          ? (resolutionData.target as NoteSaveTarget)
          : input.target;
      if (!content) {
        return fail("content is required");
      }
      return ok({
        ...input,
        content,
        target,
      });
    },
    execute: async (input, context) => {
      const item =
        zoteroGateway.getItem(context.request.activeItemId) || context.item;
      const result = await zoteroGateway.saveAnswerToNote({
        item,
        libraryID: context.request.libraryID,
        content: input.content,
        modelName: input.modelName || context.modelName,
        target: input.target,
      });
      return {
        status: result,
      };
    },
  };
}
