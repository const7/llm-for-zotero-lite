import type { ZoteroGateway } from "../../services/zoteroGateway";
import { pushUndoEntry } from "../../store/undoStore";
import type { AgentToolDefinition } from "../../types";
import { ok, fail, validateObject } from "../shared";

type EditCurrentNoteInput = {
  content: string;
  expectedOriginalHtml?: string;
  noteId?: number;
  noteTitle?: string;
};

export function createEditCurrentNoteTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<EditCurrentNoteInput, unknown> {
  return {
    spec: {
      name: "edit_current_note",
      description:
        "Replace the full content of the current open Zotero note after confirmation. Only available when a note is active.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["content"],
        properties: {
          content: {
            type: "string",
            description: "The final full text that should replace the current active note.",
          },
        },
      },
      mutability: "write",
      requiresConfirmation: true,
    },
    isAvailable: (request) => Boolean(request.activeNoteContext),
    guidance: {
      matches: (request) => Boolean(request.activeNoteContext),
      instruction:
        "When the user asks you to edit, rewrite, or update the current open note, call `edit_current_note` with the final full replacement note content instead of stopping with a prose draft.",
    },
    presentation: {
      label: "Edit Current Note",
      summaries: {
        onCall: "Preparing current-note edit",
        onPending: "Waiting for confirmation to update the current note",
        onApproved: "Approval received - updating the current note",
        onDenied: "Current-note edit cancelled",
        onSuccess: ({ content }) => {
          const title =
            content && typeof content === "object"
              ? String((content as { title?: unknown }).title || "")
              : "";
          return title ? `Updated note: ${title}` : "Current note updated";
        },
      },
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      if (typeof args.content !== "string") {
        return fail("content must be a string");
      }
      return ok({
        content: args.content,
      });
    },
    createPendingAction: (input, context) => {
      const snapshot = zoteroGateway.getActiveNoteSnapshot({
        request: context.request,
        item: context.item,
      });
      if (!snapshot) {
        throw new Error("No active note is available to edit");
      }
      input.expectedOriginalHtml = snapshot.html;
      input.noteId = snapshot.noteId;
      input.noteTitle = snapshot.title;
      return {
        toolName: "edit_current_note",
        title: `Review note update`,
        description: `Review the current note content and edit the final replacement text for "${snapshot.title}" before applying it.`,
        confirmLabel: "Apply edit",
        cancelLabel: "Cancel",
        fields: [
          {
            type: "text",
            id: "noteTitle",
            label: "Current note",
            value: snapshot.title,
          },
          {
            type: "review_table",
            id: "noteReview",
            label: "Proposed note update",
            rows: [
              {
                key: "content",
                label: "Note content",
                before: snapshot.text,
                after: input.content,
                multiline: true,
              },
            ],
          },
          {
            type: "textarea",
            id: "content",
            label: "Final note content",
            value: input.content,
          },
        ],
      };
    },
    applyConfirmation: (input, resolutionData) => {
      if (!validateObject<Record<string, unknown>>(resolutionData)) {
        return ok(input);
      }
      return ok({
        ...input,
        content:
          typeof resolutionData.content === "string"
            ? resolutionData.content
            : input.content,
      });
    },
    execute: async (input, context) => {
      const result = await zoteroGateway.replaceCurrentNote({
        request: context.request,
        item: context.item,
        content: input.content,
        expectedOriginalHtml: input.expectedOriginalHtml,
      });
      pushUndoEntry(context.request.conversationKey, {
        id: `undo-edit-current-note-${result.noteId}-${Date.now()}`,
        toolName: "edit_current_note",
        description: `Revert note edit: ${result.title}`,
        revert: async () => {
          await zoteroGateway.restoreNoteHtml({
            noteId: result.noteId,
            html: result.previousHtml,
          });
        },
      });
      return {
        status: "updated",
        noteId: result.noteId,
        title: result.title,
        noteText: result.nextText,
      };
    },
  };
}
