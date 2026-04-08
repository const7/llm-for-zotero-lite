import { assert } from "chai";

type RelayServerModule = typeof import("../src/webchat/relayServer");
type WebChatClientModule = typeof import("../src/webchat/client");

type EndpointReply = [number, string | Record<string, string>, string?];

function parseJsonReply(reply: EndpointReply | number): Record<string, unknown> {
  if (!Array.isArray(reply)) {
    throw new Error(`Unexpected endpoint reply: ${String(reply)}`);
  }
  return JSON.parse(reply[2] || "{}") as Record<string, unknown>;
}

describe("webchat relay/client", function () {
  const originalZotero = globalThis.Zotero;
  const originalToolkit = (globalThis as typeof globalThis & { ztoolkit?: any })
    .ztoolkit;

  let relayServer: RelayServerModule;
  let client: WebChatClientModule;

  const invokeEndpoint = async (
    path: string,
    method: "GET" | "POST",
    data?: unknown,
  ): Promise<Record<string, unknown>> => {
    const EndpointClass = (globalThis.Zotero.Server.Endpoints as Record<string, any>)[path];
    assert.isFunction(EndpointClass, `Missing endpoint class for ${path}`);
    const endpoint = new EndpointClass();
    return parseJsonReply(await endpoint.init({
      method,
      pathname: path,
      query: {},
      headers: {},
      data: data ?? null,
    }));
  };

  before(async function () {
    (globalThis as typeof globalThis & { Zotero: typeof Zotero }).Zotero = {
      Prefs: {
        get: () => 23119,
      },
      Server: {
        Endpoints: {},
      },
    } as typeof Zotero;
    (globalThis as typeof globalThis & { ztoolkit: { log: () => void } })
      .ztoolkit = {
      log: () => {},
    };

    relayServer = await import("../src/webchat/relayServer");
    client = await import("../src/webchat/client");
    relayServer.registerWebChatRelay();
  });

  beforeEach(function () {
    relayServer.relayResetForTests();
  });

  after(function () {
    relayServer.unregisterWebChatRelay();
    (globalThis as typeof globalThis & { Zotero?: typeof Zotero }).Zotero =
      originalZotero;
    (
      globalThis as typeof globalThis & { ztoolkit?: typeof originalToolkit }
    ).ztoolkit = originalToolkit;
  });

  it("tracks per-site history freshness without wiping other sites on empty updates", async function () {
    await invokeEndpoint("/llm-for-zotero/webchat/update_chat_history", "POST", {
      sessions: [
        {
          id: "chatgpt-1",
          title: "ChatGPT thread",
          chatUrl: "https://chatgpt.com/c/chatgpt-1",
        },
      ],
      siteHostname: "chatgpt.com",
      scrapedAt: 111,
    });
    await invokeEndpoint("/llm-for-zotero/webchat/update_chat_history", "POST", {
      sessions: [],
      siteHostname: "chat.deepseek.com",
      scrapedAt: 222,
    });

    const snapshot = relayServer.relayGetHistorySnapshot();
    assert.deepEqual(snapshot.sessions, [
      {
        id: "chatgpt-1",
        title: "ChatGPT thread",
        chatUrl: "https://chatgpt.com/c/chatgpt-1",
      },
    ]);
    assert.deepEqual(snapshot.siteSync["chatgpt.com"], { lastUpdatedAt: 111 });
    assert.deepEqual(snapshot.siteSync["chat.deepseek.com"], {
      lastUpdatedAt: 222,
    });
  });

  it("downgrades reasoning-only terminal turns to incomplete", async function () {
    const submit = relayServer.relaySubmitQuery({ prompt: "reasoning-only" });
    const claimed = relayServer.relayClaimQuery(submit.seq);
    assert.isTrue(claimed.ok);

    await invokeEndpoint("/llm-for-zotero/webchat/submit_response", "POST", {
      seq: submit.seq,
      attempt: claimed.query?.attempt || 1,
      response: "",
      thinking: "Reasoning only",
      run_state: "done",
      completion_reason: "settled",
    });

    const result = await client.pollForResponse(
      "",
      submit.seq,
      () => undefined,
      () => undefined,
      undefined,
    );

    assert.equal(result.runState, "incomplete");
    assert.equal(result.text, "");
    assert.equal(result.thinking, "Reasoning only");
    assert.equal(result.completionReason, "settled");
  });

  it("returns done when the terminal turn carries a final answer", async function () {
    const submit = relayServer.relaySubmitQuery({ prompt: "full-answer" });
    const claimed = relayServer.relayClaimQuery(submit.seq);
    assert.isTrue(claimed.ok);

    await invokeEndpoint("/llm-for-zotero/webchat/submit_response", "POST", {
      seq: submit.seq,
      attempt: claimed.query?.attempt || 1,
      response: "Final answer",
      thinking: "Trace",
      run_state: "done",
      completion_reason: "settled",
    });

    const result = await client.pollForResponse(
      "",
      submit.seq,
      () => undefined,
      () => undefined,
      undefined,
    );

    assert.equal(result.runState, "done");
    assert.equal(result.text, "Final answer");
    assert.equal(result.thinking, "Trace");
  });

  it("rejects empty terminal turns that have no answer or reasoning context", async function () {
    const submit = relayServer.relaySubmitQuery({ prompt: "empty-terminal" });
    const claimed = relayServer.relayClaimQuery(submit.seq);
    assert.isTrue(claimed.ok);

    await invokeEndpoint("/llm-for-zotero/webchat/submit_response", "POST", {
      seq: submit.seq,
      attempt: claimed.query?.attempt || 1,
      response: "",
      thinking: "",
      run_state: "done",
      completion_reason: "settled",
    });

    let thrown: Error | null = null;
    try {
      await client.pollForResponse(
        "",
        submit.seq,
        () => undefined,
        () => undefined,
        undefined,
      );
    } catch (err) {
      thrown = err as Error;
    }

    assert.instanceOf(thrown, Error);
    assert.equal(thrown?.message, "Chat finished without a visible final answer.");
  });
});
