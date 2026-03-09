import { isResponsesBase } from "../../../utils/apiHelpers";
import { providerSupportsResponsesEndpoint } from "../../../utils/providerPresets";
import type { AgentToolDefinition } from "../../types";
import {
  isExplicitWholeDocumentRequest,
  type PdfPageService,
} from "../../services/pdfPageService";
import {
  buildPdfToolSchemaProperties,
  parsePdfTargetArgs,
  type PdfTargetArgs,
} from "./pdfToolShared";
import { fail, ok } from "../shared";

function supportsNativePdfInput(apiBase: string | undefined, authMode: string | undefined): boolean {
  const normalizedBase = (apiBase || "").trim();
  if (!normalizedBase || authMode === "codex_auth") return false;
  return isResponsesBase(normalizedBase) || providerSupportsResponsesEndpoint(normalizedBase);
}

export function createPreparePdfFileForModelTool(
  pdfPageService: PdfPageService,
): AgentToolDefinition<PdfTargetArgs, unknown> {
  return {
    spec: {
      name: "prepare_pdf_file_for_model",
      description:
        "Prepare a whole PDF file for direct model input. Use this only when the user explicitly asks to inspect the entire PDF/document, and only on Responses-capable non-codex providers.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: buildPdfToolSchemaProperties(),
      },
      mutability: "read",
      requiresConfirmation: true,
    },
    validate: (args) => {
      const parsed = parsePdfTargetArgs(args);
      if (!parsed.ok) return parsed;
      return ok({
        ...parsed.value,
        scope: "whole_document" as const,
      });
    },
    shouldRequireConfirmation: async () => true,
    createPendingAction: async (input, context) => {
      const prepared = await pdfPageService.preparePdfFileForModel({
        request: context.request,
        paperContext: input.paperContext,
        itemId: input.itemId,
        contextItemId: input.contextItemId,
        attachmentId: input.attachmentId,
        name: input.name,
      });
      return {
        toolName: "prepare_pdf_file_for_model",
        args: input,
        approvalKind: "pdf_send",
        title: `Review whole-PDF input for ${prepared.target.title}`,
        description:
          "This will send the entire PDF file to the model. Use this only when full-document inspection is necessary.",
        confirmLabel: "Apply",
        cancelLabel: "Cancel",
        reviewItems: [
          {
            key: "pdf",
            label: "PDF",
            after: prepared.target.title,
          },
          {
            key: "scope",
            label: "Scope",
            after: "Whole document",
          },
        ],
      };
    },
    execute: async (input, context) => {
      if (
        !supportsNativePdfInput(context.request.apiBase, context.request.authMode)
      ) {
        throw new Error(
          "Whole-document PDF input is only available on Responses-capable non-codex providers. Use page images instead for this model.",
        );
      }
      if (!isExplicitWholeDocumentRequest(context.request.userText)) {
        throw new Error(
          "Whole-document PDF input is only allowed when the user explicitly asks to inspect the entire PDF or document.",
        );
      }
      const prepared = await pdfPageService.preparePdfFileForModel({
        request: context.request,
        paperContext: input.paperContext,
        itemId: input.itemId,
        contextItemId: input.contextItemId,
        attachmentId: input.attachmentId,
        name: input.name,
      });
      return {
        content: {
          target: {
            source: prepared.target.source,
            title: prepared.target.title,
            paperContext: prepared.target.paperContext,
            contextItemId: prepared.target.contextItemId,
            itemId: prepared.target.itemId,
          },
          transport: "native_pdf_file",
          scope: "whole_document",
        },
        artifacts: [prepared.artifact],
      };
    },
  };
}
