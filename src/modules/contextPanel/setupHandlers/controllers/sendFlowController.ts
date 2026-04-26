import { MAX_SELECTED_IMAGES } from "../../constants";
import type { ProviderProtocol } from "../../../../utils/providerProtocol";
import type {
  AdvancedModelParams,
  ChatAttachment,
  PaperContextRef,
  SelectedTextContext,
  SelectedTextSource,
} from "../../types";
import type { ReasoningConfig as LLMReasoningConfig } from "../../../../utils/llmClient";

type StatusLevel = "ready" | "warning" | "error";

type SelectedProfile = {
  entryId: string;
  model: string;
  apiBase: string;
  apiKey: string;
  providerLabel: string;
  authMode?: "api_key" | "codex_auth" | "copilot_auth" | "webchat";
  providerProtocol?: ProviderProtocol;
};

type SendFlowControllerDeps = {
  body: Element;
  inputBox: HTMLTextAreaElement;
  getItem: () => Zotero.Item | null;
  closeAddMenu: () => void;
  closePaperPicker: () => void;
  getSelectedTextContextEntries: (itemId: number) => SelectedTextContext[];
  getSelectedPaperContexts: (itemId: number) => PaperContextRef[];
  getFullTextPaperContexts: (
    item: Zotero.Item,
    paperContexts: PaperContextRef[],
  ) => PaperContextRef[];
  getPdfModePaperContexts: (
    item: Zotero.Item,
    paperContexts: PaperContextRef[],
  ) => PaperContextRef[];
  resolvePdfPaperAttachments: (
    paperContexts: PaperContextRef[],
  ) => Promise<ChatAttachment[]>;
  renderPdfPagesAsImages: (
    paperContexts: PaperContextRef[],
  ) => Promise<string[]>;
  getModelPdfSupport: (
    modelName: string,
    providerProtocol?: string,
    authMode?: string,
    apiBase?: string,
  ) => "native" | "upload" | "image_url" | "vision" | "none";
  uploadPdfForProvider: (params: {
    apiBase: string;
    apiKey: string;
    pdfBytes: Uint8Array;
    fileName: string;
  }) => Promise<{ systemMessageContent: string; label: string } | null>;
  resolvePdfBytes: (paperContext: PaperContextRef) => Promise<Uint8Array>;
  encodeBytesBase64: (bytes: Uint8Array) => string;
  getSelectedFiles: (itemId: number) => ChatAttachment[];
  getSelectedImages: (itemId: number) => string[];
  resolvePromptText: (
    text: string,
    selectedText: string,
    hasAttachmentContext: boolean,
  ) => string;
  buildQuestionWithSelectedTextContexts: (
    selectedTexts: string[],
    selectedTextSources: SelectedTextSource[],
    promptText: string,
    options?: {
      selectedTextPaperContexts?: (PaperContextRef | undefined)[];
      includePaperAttribution?: boolean;
    },
  ) => string;
  buildModelPromptWithFileContext: (
    question: string,
    attachments: ChatAttachment[],
  ) => string;
  normalizeConversationTitleSeed: (raw: unknown) => string;
  getConversationKey: (item: Zotero.Item) => number;
  touchPaperConversationTitle: (
    conversationKey: number,
    title: string,
  ) => Promise<void>;
  getSelectedProfile: () => SelectedProfile | null;
  getCurrentModelName: () => string;
  isImageContextUnsupportedModel: (modelName: string) => boolean;
  getSelectedReasoning: () => LLMReasoningConfig | undefined;
  getAdvancedModelParams: (
    entryId: string | undefined,
  ) => AdvancedModelParams | undefined;
  sendQuestion: (
    opts: import("../../types").SendQuestionOptions,
  ) => Promise<void>;
  retainPinnedImageState: (itemId: number) => void;
  retainPaperState: (itemId: number) => void;
  consumePaperModeState: (itemId: number) => void;
  retainPinnedFileState: (itemId: number) => void;
  retainPinnedTextState: (conversationKey: number) => void;
  updatePaperPreviewPreservingScroll: () => void;
  updateFilePreviewPreservingScroll: () => void;
  updateImagePreviewPreservingScroll: () => void;
  updateSelectedTextPreviewPreservingScroll: () => void;
  scheduleAttachmentGc: () => void;
  refreshPaperHistoryHeader: () => void;
  persistDraftInput: () => void;
  setStatusMessage?: (message: string, level: StatusLevel) => void;
  // [webchat]
  hasActivePdfFullTextPapers?: (
    item: Zotero.Item,
    paperContexts?: PaperContextRef[],
  ) => boolean;
  hasUploadedPdfInCurrentWebChatConversation?: () => boolean;
  markWebChatPdfUploadedForCurrentConversation?: () => void;
  consumeWebChatForceNewChatIntent?: () => boolean;
};

export function createSendFlowController(deps: SendFlowControllerDeps): {
  doSend: () => Promise<void>;
} {
  const doSend = async () => {
    const item = deps.getItem();
    if (!item) return;

    deps.closeAddMenu();
    deps.closePaperPicker();

    const textContextConversationKey = deps.getConversationKey(item);
    const text = deps.inputBox.value.trim();
    const selectedContexts = deps.getSelectedTextContextEntries(
      textContextConversationKey,
    );
    const selectedTexts = selectedContexts.map((entry) => entry.text);
    const selectedTextSources = selectedContexts.map((entry) => entry.source);
    const selectedTextPaperContexts = selectedContexts.map(
      (entry) => entry.paperContext,
    );
    const primarySelectedText = selectedTexts[0] || "";
    const allSelectedPaperContexts = deps.getSelectedPaperContexts(item.id);
    const pdfModePaperContexts = deps.getPdfModePaperContexts(
      item,
      allSelectedPaperContexts,
    );
    const selectedProfile = deps.getSelectedProfile();
    const isWebChat = selectedProfile?.authMode === "webchat";
    const activeModelName = (
      selectedProfile?.model ||
      deps.getCurrentModelName() ||
      ""
    ).trim();
    const pdfModeKeySet = new Set(
      pdfModePaperContexts.map((p) => `${p.itemId}:${p.contextItemId}`),
    );
    const selectedPaperContexts = allSelectedPaperContexts.filter(
      (p) => !pdfModeKeySet.has(`${p.itemId}:${p.contextItemId}`),
    );
    const fullTextPaperContexts = deps.getFullTextPaperContexts(
      item,
      selectedPaperContexts,
    );
    let pdfFileAttachments: ChatAttachment[] = [];
    let pdfPageImageDataUrls: string[] = [];
    let pdfUploadSystemMessages: string[] = [];
    if (pdfModePaperContexts.length && !isWebChat) {
      const pdfSupport = deps.getModelPdfSupport(
        activeModelName,
        selectedProfile?.providerProtocol,
        selectedProfile?.authMode,
        selectedProfile?.apiBase,
      );
      if (pdfSupport === "none") {
        deps.setStatusMessage?.(
          "This model does not support PDF or image input. PDF papers were skipped.",
          "error",
        );
      } else if (
        pdfSupport === "upload" &&
        selectedProfile?.apiBase &&
        selectedProfile.apiKey
      ) {
        const isQwen = selectedProfile.apiBase
          .toLowerCase()
          .includes("dashscope");
        const isQwenLong = /^qwen-long(?:[.-]|$)/i.test(activeModelName);
        if (isQwen && !isQwenLong) {
          deps.setStatusMessage?.(
            `Only qwen-long supports PDF upload on DashScope. Current model: ${activeModelName}. PDF papers were skipped.`,
            "error",
          );
        } else {
          deps.inputBox.disabled = true;
          deps.setStatusMessage?.(
            `Uploading PDF to ${activeModelName}...`,
            "ready",
          );
          for (const pc of pdfModePaperContexts) {
            try {
              const result = await deps.uploadPdfForProvider({
                apiBase: selectedProfile.apiBase,
                apiKey: selectedProfile.apiKey,
                pdfBytes: await deps.resolvePdfBytes(pc),
                fileName: (() => {
                  const raw = pc.attachmentTitle || pc.title || "document";
                  return /\.pdf$/i.test(raw) ? raw : `${raw}.pdf`;
                })(),
              });
              if (result) {
                pdfUploadSystemMessages.push(result.systemMessageContent);
                deps.setStatusMessage?.(`${result.label}`, "ready");
              }
            } catch (err) {
              ztoolkit.log("LLM: PDF upload failed for", pc.contextItemId, err);
              deps.setStatusMessage?.(
                "PDF upload failed. Falling back to text mode.",
                "error",
              );
            }
          }
        }
      } else if (pdfSupport === "image_url") {
        deps.inputBox.disabled = true;
        deps.setStatusMessage?.(
          `PDF upload via third-party provider may not work. Attempting base64 encoding...`,
          "warning",
        );
        for (const pc of pdfModePaperContexts) {
          try {
            const pdfBytes = await deps.resolvePdfBytes(pc);
            const base64 = deps.encodeBytesBase64(pdfBytes);
            pdfPageImageDataUrls.push(`data:application/pdf;base64,${base64}`);
          } catch (err) {
            ztoolkit.log(
              "LLM: PDF base64 encoding failed for",
              pc.contextItemId,
              err,
            );
            const fallback = await deps.renderPdfPagesAsImages([pc]);
            pdfPageImageDataUrls.push(...fallback);
          }
        }
        deps.setStatusMessage?.(
          `Sending ${pdfPageImageDataUrls.length} PDF(s)...`,
          "ready",
        );
      } else if (pdfSupport === "vision") {
        if (deps.isImageContextUnsupportedModel(activeModelName)) {
          deps.setStatusMessage?.(
            "This model does not support image input. PDF pages will be sent as text.",
            "warning",
          );
        } else {
          deps.inputBox.disabled = true;
          deps.setStatusMessage?.(
            `PDF will be sent as page images (vision mode) for ${activeModelName}...`,
            "ready",
          );
          pdfPageImageDataUrls =
            await deps.renderPdfPagesAsImages(pdfModePaperContexts);
          deps.setStatusMessage?.(
            `Sending ${pdfPageImageDataUrls.length} page image(s)...`,
            "ready",
          );
        }
      } else {
        deps.setStatusMessage?.(
          `Sending native PDF to ${activeModelName}...`,
          "ready",
        );
        pdfFileAttachments =
          await deps.resolvePdfPaperAttachments(pdfModePaperContexts);
      }
      deps.inputBox.disabled = false;
    }
    const selectedFiles = [
      ...deps.getSelectedFiles(item.id),
      ...pdfFileAttachments,
    ];

    if (
      !text &&
      !primarySelectedText &&
      !selectedPaperContexts.length &&
      !selectedFiles.length
    ) {
      return;
    }

    const promptText = deps.resolvePromptText(
      text,
      primarySelectedText,
      selectedFiles.length > 0 || selectedPaperContexts.length > 0,
    );
    if (!promptText) return;

    const resolvedPromptText =
      !text &&
      !primarySelectedText &&
      selectedPaperContexts.length > 0 &&
      !selectedFiles.length
        ? "Please analyze selected papers."
        : promptText;

    const composedQuestionBase = primarySelectedText
      ? deps.buildQuestionWithSelectedTextContexts(
          selectedTexts,
          selectedTextSources,
          resolvedPromptText,
          {
            selectedTextPaperContexts,
            includePaperAttribution: false,
          },
        )
      : resolvedPromptText;

    const composedQuestion = deps.buildModelPromptWithFileContext(
      composedQuestionBase,
      selectedFiles,
    );
    const displayQuestion = primarySelectedText
      ? resolvedPromptText
      : text || resolvedPromptText;

    const titleSeed =
      deps.normalizeConversationTitleSeed(text) ||
      deps.normalizeConversationTitleSeed(resolvedPromptText);
    if (titleSeed) {
      void deps
        .touchPaperConversationTitle(deps.getConversationKey(item), titleSeed)
        .catch((err) => {
          ztoolkit.log("LLM: Failed to touch paper conversation title", err);
        });
    }

    const selectedImages = deps
      .getSelectedImages(item.id)
      .slice(0, MAX_SELECTED_IMAGES);
    const images = [
      ...(deps.isImageContextUnsupportedModel(activeModelName)
        ? []
        : selectedImages),
      ...pdfPageImageDataUrls,
    ].slice(0, MAX_SELECTED_IMAGES);
    const selectedReasoning = deps.getSelectedReasoning();
    const advancedParams = deps.getAdvancedModelParams(
      selectedProfile?.entryId,
    );
    const clearDraftAndRetainContext = (): void => {
      deps.inputBox.value = "";
      deps.persistDraftInput();
      deps.retainPinnedImageState(item.id);
      deps.consumePaperModeState(item.id);
      deps.retainPaperState(item.id);
      deps.updatePaperPreviewPreservingScroll();
      if (selectedFiles.length) {
        deps.retainPinnedFileState(item.id);
        deps.updateFilePreviewPreservingScroll();
      }
      deps.updateImagePreviewPreservingScroll();
      if (primarySelectedText) {
        deps.retainPinnedTextState(textContextConversationKey);
        deps.updateSelectedTextPreviewPreservingScroll();
      }
    };

    clearDraftAndRetainContext();

    const webchatForceNewChat = isWebChat
      ? (deps.consumeWebChatForceNewChatIntent?.() ?? false)
      : false;
    const webchatSendPdf = isWebChat
      ? (deps.hasActivePdfFullTextPapers?.(item, allSelectedPaperContexts) ??
          false) &&
        (webchatForceNewChat ||
          !(deps.hasUploadedPdfInCurrentWebChatConversation?.() ?? false))
      : false;

    const sendTask = deps.sendQuestion({
      body: deps.body,
      item,
      question: composedQuestion,
      images,
      model: selectedProfile?.model,
      apiBase: selectedProfile?.apiBase,
      apiKey: selectedProfile?.apiKey,
      authMode: selectedProfile?.authMode,
      providerProtocol: selectedProfile?.providerProtocol,
      modelEntryId: selectedProfile?.entryId,
      modelProviderLabel: selectedProfile?.providerLabel,
      reasoning: selectedReasoning,
      advanced: advancedParams,
      displayQuestion,
      selectedTexts: selectedTexts.length ? selectedTexts : undefined,
      selectedTextSources: selectedTexts.length
        ? selectedTextSources
        : undefined,
      selectedTextPaperContexts: selectedTexts.length
        ? selectedTextPaperContexts
        : undefined,
      paperContexts: selectedPaperContexts,
      fullTextPaperContexts,
      attachments: selectedFiles.length ? selectedFiles : undefined,
      pdfModePaperKeys: pdfModeKeySet.size > 0 ? pdfModeKeySet : undefined,
      pdfUploadSystemMessages: pdfUploadSystemMessages.length
        ? pdfUploadSystemMessages
        : undefined,
      webchatSendPdf,
      webchatForceNewChat,
    });
    const win = deps.body.ownerDocument?.defaultView;
    if (win) {
      win.setTimeout(() => {
        deps.refreshPaperHistoryHeader();
      }, 120);
    }
    await sendTask;
    if (isWebChat && webchatSendPdf) {
      deps.markWebChatPdfUploadedForCurrentConversation?.();
    }
    deps.refreshPaperHistoryHeader();
  };

  return { doSend };
}
