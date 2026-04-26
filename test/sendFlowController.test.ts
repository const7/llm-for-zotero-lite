import { assert } from "chai";
import type {
  ChatAttachment,
  PaperContextRef,
  SelectedTextContext,
} from "../src/modules/contextPanel/types";
import { createSendFlowController } from "../src/modules/contextPanel/setupHandlers/controllers/sendFlowController";

describe("sendFlowController", function () {
  const item = { id: 101 } as unknown as Zotero.Item;
  const selectedPaper: PaperContextRef = {
    itemId: 12,
    contextItemId: 34,
    title: "Pinned paper",
  };
  const selectedFile: ChatAttachment = {
    id: "file-1",
    name: "paper-summary.md",
    mimeType: "text/markdown",
    sizeBytes: 20,
    category: "markdown",
  };
  const selectedTextContexts: SelectedTextContext[] = [
    { text: "selected text", source: "pdf" },
  ];

  function createBaseDeps(overrides: Record<string, unknown> = {}) {
    const inputBox = {
      value: "ask question",
      dataset: {},
    } as HTMLTextAreaElement;
    let draftValue = inputBox.value;
    let sendCalled = 0;
    let retainImageCalled = 0;
    let retainPaperStateCalled = 0;
    let consumePaperModeStateCalled = 0;
    let retainFileCalled = 0;
    let retainTextCalled = 0;
    let persistDraftInputCalls = 0;
    let lastSentQuestion = "";
    let lastPdfUploadSystemMessages: string[] | undefined;
    let resolvePdfPaperAttachmentsCalls = 0;
    let renderPdfPagesAsImagesCalls = 0;
    let uploadPdfForProviderCalls = 0;

    const deps = {
      body: {} as Element,
      inputBox,
      getItem: () => item,
      closeAddMenu: () => undefined,
      closePaperPicker: () => undefined,
      getSelectedTextContextEntries: () => selectedTextContexts,
      getSelectedPaperContexts: () => [selectedPaper],
      getFullTextPaperContexts: () => [selectedPaper],
      getPdfModePaperContexts: () => [],
      resolvePdfPaperAttachments: async () => {
        resolvePdfPaperAttachmentsCalls += 1;
        return [];
      },
      renderPdfPagesAsImages: async () => {
        renderPdfPagesAsImagesCalls += 1;
        return [];
      },
      getModelPdfSupport: () => "none" as const,
      uploadPdfForProvider: async () => {
        uploadPdfForProviderCalls += 1;
        return null;
      },
      resolvePdfBytes: async () => new Uint8Array(),
      encodeBytesBase64: () => "",
      getSelectedFiles: () => [selectedFile],
      getSelectedImages: () => ["data:image/png;base64,AAA"],
      resolvePromptText: () => "ask question",
      buildQuestionWithSelectedTextContexts: (
        _selectedTexts: string[],
        _sources: unknown,
        promptText: string,
      ) => `${promptText} (with selected text)`,
      buildModelPromptWithFileContext: (
        question: string,
        attachments: ChatAttachment[],
      ) => `${question} [files=${attachments.length}]`,
      normalizeConversationTitleSeed: (raw: unknown) => String(raw || ""),
      getConversationKey: () => item.id,
      touchPaperConversationTitle: async () => undefined,
      getSelectedProfile: () => null,
      getCurrentModelName: () => "",
      isImageContextUnsupportedModel: () => false,
      getSelectedReasoning: () => undefined,
      getAdvancedModelParams: () => undefined,
      sendQuestion: async (opts: any) => {
        sendCalled += 1;
        lastSentQuestion = opts.question;
        lastPdfUploadSystemMessages = opts.pdfUploadSystemMessages;
      },
      retainPinnedImageState: () => {
        retainImageCalled += 1;
      },
      retainPaperState: () => {
        retainPaperStateCalled += 1;
      },
      consumePaperModeState: () => {
        consumePaperModeStateCalled += 1;
      },
      retainPinnedFileState: () => {
        retainFileCalled += 1;
      },
      retainPinnedTextState: () => {
        retainTextCalled += 1;
      },
      updatePaperPreviewPreservingScroll: () => undefined,
      updateFilePreviewPreservingScroll: () => undefined,
      updateImagePreviewPreservingScroll: () => undefined,
      updateSelectedTextPreviewPreservingScroll: () => undefined,
      scheduleAttachmentGc: () => undefined,
      refreshPaperHistoryHeader: () => undefined,
      persistDraftInput: () => {
        persistDraftInputCalls += 1;
        draftValue = inputBox.value;
      },
      setStatusMessage: () => undefined,
      editStaleStatusText: "stale",
      ...overrides,
    };

    const controller = createSendFlowController(deps as any);
    return {
      controller,
      inputBox,
      getCounts: () => ({
        sendCalled,
        retainImageCalled,
        retainPaperStateCalled,
        consumePaperModeStateCalled,
        retainFileCalled,
        retainTextCalled,
        persistDraftInputCalls,
        resolvePdfPaperAttachmentsCalls,
        renderPdfPagesAsImagesCalls,
        uploadPdfForProviderCalls,
      }),
      getDraftValue: () => draftValue,
      getLastSend: () => ({
        lastSentQuestion,
        lastPdfUploadSystemMessages,
      }),
    };
  }

  it("uses retain-pinned callbacks for normal send flow", async function () {
    const { controller, inputBox, getCounts } = createBaseDeps();
    await controller.doSend();
    const counts = getCounts();

    assert.equal(inputBox.value, "");
    assert.equal(counts.sendCalled, 1);
    assert.equal(counts.retainImageCalled, 1);
    assert.equal(counts.consumePaperModeStateCalled, 1);
    assert.equal(counts.retainPaperStateCalled, 1);
    assert.equal(counts.retainFileCalled, 1);
    assert.equal(counts.retainTextCalled, 1);
  });

  it("passes provider-uploaded PDF context through normal sends", async function () {
    const { controller, getLastSend } = createBaseDeps({
      getSelectedFiles: () => [],
      getFullTextPaperContexts: () => [],
      getPdfModePaperContexts: () => [selectedPaper],
      getSelectedProfile: () => ({
        entryId: "entry-1",
        model: "kimi-k2.5",
        apiBase: "https://api.moonshot.cn/v1",
        apiKey: "test-key",
        providerLabel: "Kimi",
        authMode: "api_key",
        providerProtocol: "openai_chat_compat",
      }),
      getModelPdfSupport: () => "upload" as const,
      resolvePdfBytes: async () => new Uint8Array([1, 2, 3]),
      uploadPdfForProvider: async () => ({
        systemMessageContent: "uploaded pdf context",
        label: "Uploaded",
      }),
    });

    await controller.doSend();

    assert.deepEqual(getLastSend().lastPdfUploadSystemMessages, [
      "uploaded pdf context",
    ]);
  });

  it("persists the cleared draft before preview sync in normal send flow", async function () {
    const { controller, inputBox, getCounts, getDraftValue } = createBaseDeps({
      updatePaperPreviewPreservingScroll: () => {
        inputBox.value = getDraftValue();
      },
      updateFilePreviewPreservingScroll: () => {
        inputBox.value = getDraftValue();
      },
      updateImagePreviewPreservingScroll: () => {
        inputBox.value = getDraftValue();
      },
      updateSelectedTextPreviewPreservingScroll: () => {
        inputBox.value = getDraftValue();
      },
    });

    await controller.doSend();
    const counts = getCounts();

    assert.equal(getDraftValue(), "");
    assert.equal(inputBox.value, "");
    assert.equal(counts.persistDraftInputCalls, 1);
  });

  it("keeps normal paper chat on the lean fast path", async function () {
    const { controller, getCounts, getLastSend } = createBaseDeps({
      getSelectedFiles: () => [],
      getPdfModePaperContexts: () => [selectedPaper],
      getSelectedProfile: () => ({
        entryId: "entry-1",
        model: "gpt-5",
        apiBase: "https://chatgpt.com/backend-api/codex/responses",
        apiKey: "test-key",
        providerLabel: "OpenAI (codex auth)",
        authMode: "codex_auth",
        providerProtocol: "responses",
      }),
      resolvePromptText: () => "summarize the paper",
    });

    await controller.doSend();

    const counts = getCounts();
    const lastSend = getLastSend();
    assert.equal(counts.resolvePdfPaperAttachmentsCalls, 0);
    assert.equal(counts.renderPdfPagesAsImagesCalls, 0);
    assert.equal(counts.uploadPdfForProviderCalls, 0);
    assert.equal(
      lastSend.lastSentQuestion,
      "summarize the paper (with selected text) [files=0]",
    );
  });
});
