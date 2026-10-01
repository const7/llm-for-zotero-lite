import { assert } from "chai";
import {
  callEmbeddings,
  callLLM,
  callLLMStream,
  getResolvedEmbeddingConfig,
  prepareChatRequest,
} from "../src/utils/llmClient";

describe("llmClient prepareChatRequest", function () {
  const originalZotero = globalThis.Zotero;
  const originalToolkit = (
    globalThis as typeof globalThis & { ztoolkit?: unknown }
  ).ztoolkit;

  beforeEach(function () {
    const prefStore = new Map<string, unknown>();
    (globalThis as typeof globalThis & { Zotero: typeof Zotero }).Zotero = {
      Prefs: {
        get: (key: string) => prefStore.get(key) ?? "",
        set: (key: string, value: unknown) => {
          prefStore.set(key, value);
        },
      },
    } as typeof Zotero;
  });

  after(function () {
    (globalThis as typeof globalThis & { Zotero?: typeof Zotero }).Zotero =
      originalZotero;
    (
      globalThis as typeof globalThis & { ztoolkit?: typeof originalToolkit }
    ).ztoolkit = originalToolkit;
  });

  it("reports document-context trimming effects before the request is sent", function () {
    const prepared = prepareChatRequest({
      prompt: "Summarize the paper.",
      context: "A".repeat(700000),
      model: "deepseek-chat",
      apiBase: "https://api.example.com/v1",
    });

    assert.isTrue(prepared.inputCap.capped);
    assert.isTrue(
      prepared.inputCap.effects.documentContextTrimmed ||
        prepared.inputCap.effects.documentContextDropped,
    );
  });

  it("includes extra system messages in the prepared request payload", function () {
    const prepared = prepareChatRequest({
      prompt: "Answer the question.",
      context: "Small context.",
      model: "gpt-4o-mini",
      apiBase: "https://api.example.com/v1",
      systemMessages: ["Briefly mention that retrieval was used."],
    });

    assert.include(
      prepared.messages.map((message) => String(message.content)).join("\n"),
      "Briefly mention that retrieval was used.",
    );
  });

  it("keeps system prompts inside input messages for Grok responses requests", async function () {
    let capturedBody: Record<string, unknown> | null = null;
    (
      globalThis as typeof globalThis & {
        ztoolkit: { getGlobal: (name: string) => unknown; log: () => void };
      }
    ).ztoolkit = {
      getGlobal: (name: string) => {
        if (name === "fetch") {
          return async (_url: string, init?: RequestInit) => {
            capturedBody = JSON.parse(String(init?.body || "{}")) as Record<
              string,
              unknown
            >;
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              json: async () => ({ output_text: "OK" }),
              text: async () => "",
            };
          };
        }
        return undefined;
      },
      log: () => undefined,
    };

    const output = await callLLM({
      prompt: "Say hi.",
      model: "grok-4",
      apiBase: "https://api.x.ai/v1/responses",
      apiKey: "xai-test",
    });

    assert.equal(output, "OK");
    assert.isNotNull(capturedBody);
    assert.notProperty(capturedBody as object, "instructions");
    assert.isArray(capturedBody?.input);
    const input = capturedBody?.input as Array<Record<string, unknown>>;
    assert.equal(input[0]?.role, "system");
    assert.include(
      String(input[0]?.content || ""),
      "You are an intelligent research assistant",
    );
    assert.equal(input[input.length - 1]?.role, "user");
  });

  it("merges paper chat system messages into a single leading system entry", async function () {
    let capturedBody: Record<string, unknown> | null = null;
    (
      globalThis.Zotero.Prefs as { set: (key: string, value: unknown) => void }
    ).set(
      "extensions.zotero.llmforzoterolite.systemPrompt",
      "You are a custom paper analyst.",
    );
    (
      globalThis as typeof globalThis & {
        ztoolkit: { getGlobal: (name: string) => unknown; log: () => void };
      }
    ).ztoolkit = {
      getGlobal: (name: string) => {
        if (name === "fetch") {
          return async (_url: string, init?: RequestInit) => {
            capturedBody = JSON.parse(String(init?.body || "{}")) as Record<
              string,
              unknown
            >;
            const encoder = new TextEncoder();
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              body: new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    encoder.encode(
                      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
                    ),
                  );
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                },
              }),
              json: async () => ({}),
              text: async () => "",
            };
          };
        }
        return undefined;
      },
      log: () => undefined,
    };

    const output = await callLLMStream(
      {
        prompt: "Summarize the attached paper.",
        context: "Paper context body.",
        history: [
          { role: "user", content: "Earlier question." },
          { role: "assistant", content: "Earlier answer." },
        ],
        model: "Qwen/Qwen3.5-27B",
        apiBase: "https://api.siliconflow.cn/v1",
        apiKey: "sf-test",
        systemMessages: ["Mention if the document context was trimmed."],
      },
      () => undefined,
    );

    assert.equal(output, "OK");
    assert.isNotNull(capturedBody);
    assert.isArray(capturedBody?.messages);
    const messages = capturedBody?.messages as Array<Record<string, unknown>>;
    assert.deepEqual(
      messages.map((message) => message.role),
      ["system", "user", "assistant", "user"],
    );
    assert.equal(
      messages.filter((message) => message.role === "system").length,
      1,
    );
    assert.include(
      String(messages[0]?.content || ""),
      "You are a custom paper analyst.",
    );
    assert.include(String(messages[0]?.content || ""), "Document Context:");
    assert.include(
      String(messages[0]?.content || ""),
      "Mention if the document context was trimmed.",
    );
  });

  it("keeps explicit Codex App Server mode in prepared request", function () {
    const prepared = prepareChatRequest({
      prompt: "hello",
      model: "gpt-5.4",
      apiBase: "",
      authMode: "codex_app_server",
    });

    assert.equal(prepared.authMode, "codex_app_server");
  });

  it("throws when no dedicated embedding provider is configured", async function () {
    const setPref = globalThis.Zotero.Prefs.set as (
      key: string,
      value: unknown,
    ) => void;
    setPref("extensions.zotero.llmforzoterolite.embeddingProvider", "");
    setPref("extensions.zotero.llmforzoterolite.embeddingApiBase", "");
    try {
      await callEmbeddings(["hello"]);
      assert.fail("expected callEmbeddings to throw");
    } catch (error) {
      assert.include(
        (error as Error).message,
        "No embedding provider configured",
      );
    }
  });

  it("changes embedding keys when the dedicated provider config changes", function () {
    const setPref = globalThis.Zotero.Prefs.set as (
      key: string,
      value: unknown,
    ) => void;
    setPref("extensions.zotero.llmforzoterolite.embeddingProvider", "openai");
    setPref(
      "extensions.zotero.llmforzoterolite.embeddingApiBase",
      "https://api.openai.com/v1",
    );
    setPref("extensions.zotero.llmforzoterolite.embeddingApiKey", "sk-first");
    setPref(
      "extensions.zotero.llmforzoterolite.embeddingModel",
      "text-embedding-3-small",
    );
    const initial = getResolvedEmbeddingConfig();

    setPref(
      "extensions.zotero.llmforzoterolite.embeddingApiBase",
      "https://proxy.example/v1",
    );
    const endpointChanged = getResolvedEmbeddingConfig();

    setPref(
      "extensions.zotero.llmforzoterolite.embeddingApiBase",
      "https://api.openai.com/v1",
    );
    setPref("extensions.zotero.llmforzoterolite.embeddingApiKey", "sk-second");
    const keyChanged = getResolvedEmbeddingConfig();

    assert.notEqual(initial.providerKey, endpointChanged.providerKey);
    assert.notEqual(initial.attemptKey, keyChanged.attemptKey);
  });
});
