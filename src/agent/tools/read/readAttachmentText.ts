import type { AgentToolDefinition } from "../../types";
import {
  fail,
  findAttachment,
  ok,
  validateObject,
} from "../shared";

type ReadAttachmentTextInput = {
  attachmentId?: string;
  name?: string;
};

export function createReadAttachmentTextTool(): AgentToolDefinition<
  ReadAttachmentTextInput,
  unknown
> {
  return {
    spec: {
      name: "read_attachment_text",
      description:
        "Read extracted text content from one of the currently attached non-image files.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          attachmentId: { type: "string" },
          name: { type: "string" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail<ReadAttachmentTextInput>("Expected an object");
      }
      const attachmentId =
        typeof args.attachmentId === "string" && args.attachmentId.trim()
          ? args.attachmentId.trim()
          : undefined;
      const name =
        typeof args.name === "string" && args.name.trim()
          ? args.name.trim()
          : undefined;
      if (!attachmentId && !name) {
        return fail<ReadAttachmentTextInput>(
          "attachmentId or name is required",
        );
      }
      return ok<ReadAttachmentTextInput>({
        attachmentId,
        name,
      });
    },
    execute: async (input, context) => {
      const attachment = findAttachment(context.request.attachments, input);
      if (!attachment) {
        throw new Error("Attachment not found in the current request");
      }
      return {
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        textContent: attachment.textContent || "",
      };
    },
  };
}
