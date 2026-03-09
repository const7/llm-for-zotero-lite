import type { AgentToolDefinition } from "../../types";
import type {
  LibraryPaperTarget,
  ZoteroGateway,
} from "../../services/zoteroGateway";
import {
  fail,
  normalizePositiveIntArray,
  normalizeStringArray,
  ok,
  validateObject,
} from "../shared";

type ApplyTagsInput = {
  itemIds: number[];
  tags: string[];
};

function formatTagList(tags: string[]): string {
  return tags.join("\n");
}

function parseTagText(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .split(/\r?\n|,/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!normalized.length) return null;
  return Array.from(new Set(normalized));
}

function describeTarget(target: LibraryPaperTarget): string {
  const currentTags = target.tags.length
    ? `Current tags: ${target.tags.join(", ")}`
    : "Current tags: none";
  const creatorYear = [target.firstCreator, target.year].filter(Boolean).join(" • ");
  return creatorYear ? `${creatorYear}\n${currentTags}` : currentTags;
}

function parseSelectedItemIds(
  value: unknown,
  fallbackItemIds: number[],
): number[] | null {
  if (!Array.isArray(value)) return fallbackItemIds;
  const normalized = normalizePositiveIntArray(value);
  return normalized && normalized.length ? normalized : null;
}

export function createApplyTagsTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<ApplyTagsInput, unknown> {
  return {
    spec: {
      name: "apply_tags",
      description:
        "Append manual tags to one or more Zotero papers after a single user approval.",
      inputSchema: {
        type: "object",
        required: ["itemIds", "tags"],
        additionalProperties: false,
        properties: {
          itemIds: {
            type: "array",
            items: { type: "number" },
          },
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      mutability: "write",
      requiresConfirmation: true,
    },
    presentation: {
      label: "Apply Tags",
      summaries: {
        onCall: "Preparing tag updates for the selected papers",
        onPending: "Waiting for your approval before applying the tags",
        onApproved: "Approval received - applying the tags",
        onDenied: "Tag updates cancelled",
        onSuccess: ({ content }) => {
          const updatedCount =
            content && typeof content === "object"
              ? Number((content as { updatedCount?: unknown }).updatedCount || 0)
              : 0;
          return updatedCount > 0
            ? `Applied tags to ${updatedCount} paper${
                updatedCount === 1 ? "" : "s"
              }`
            : "No tag updates were needed";
        },
      },
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      const itemIds = normalizePositiveIntArray(args.itemIds);
      const tags = normalizeStringArray(args.tags);
      if (!itemIds?.length) {
        return fail("itemIds is required");
      }
      if (!tags?.length) {
        return fail("tags is required");
      }
      return ok<ApplyTagsInput>({
        itemIds,
        tags,
      });
    },
    createPendingAction: (input) => {
      const targets = zoteroGateway.getPaperTargetsByItemIds(input.itemIds);
      return {
        toolName: "apply_tags",
        title: `Review tag updates for ${targets.length} paper${
          targets.length === 1 ? "" : "s"
        }`,
        description:
          "Tags will be appended as manual tags. Existing tags will be left unchanged.",
        confirmLabel: "Apply tags",
        cancelLabel: "Cancel",
        fields: [
          {
            type: "textarea",
            id: "tags",
            label: "Tags",
            value: formatTagList(input.tags),
          },
          {
            type: "checklist",
            id: "selectedItemIds",
            label: "Apply tags to these papers",
            items: targets.map((target) => ({
              id: `${target.itemId}`,
              label: target.title,
              description: describeTarget(target),
              checked: true,
            })),
          },
        ],
      };
    },
    applyConfirmation: (input, resolutionData) => {
      if (!validateObject<Record<string, unknown>>(resolutionData)) {
        return ok(input);
      }
      const tags =
        parseTagText(resolutionData.tags) ||
        (normalizeStringArray(resolutionData.tags) ?? input.tags);
      if (!tags?.length) {
        return fail("At least one tag is required");
      }
      const itemIds = parseSelectedItemIds(resolutionData.selectedItemIds, input.itemIds);
      if (!itemIds?.length) {
        return fail("Select at least one paper");
      }
      return ok({
        itemIds,
        tags,
      });
    },
    execute: async (input) =>
      zoteroGateway.applyTagsToItems({
        itemIds: input.itemIds,
        tags: input.tags,
      }),
  };
}
