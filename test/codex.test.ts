import { config } from "../package.json";
import {
  getCachedCodexModels,
  getCodexReasoningOptions,
  refreshCodexModels,
  resolveCodexEffort,
  stopCodexModelRefresh,
} from "../src/codex/models";
import { assert } from "chai";
import {
  buildCodexInput,
  runCodexChat,
  stopCodexRequests,
} from "../src/codex/client";
import { CodexRpc, type CodexProcess } from "../src/codex/rpc";

class Pipe {
  queue: string[] = [];
  waiter?: (value: string | null) => void;
  ended = false;
  push(value: unknown) {
    const text = JSON.stringify(value) + "\n";
    if (this.waiter) {
      const next = this.waiter;
      this.waiter = undefined;
      next(text);
    } else this.queue.push(text);
  }
  async readString(): Promise<string | null> {
    if (this.queue.length) return this.queue.shift()!;
    if (this.ended) return null;
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
  end() {
    this.ended = true;
    this.waiter?.(null);
  }
}

class FakeProcess implements CodexProcess {
  stdout = new Pipe();
  stderr = new Pipe();
  killed = false;
  calls: any[] = [];
  onCall: (message: any) => void = () => {};
  stdin = {
    write: async (text: string) => {
      const message = JSON.parse(text);
      this.calls.push(message);
      this.onCall(message);
    },
  };
  wait() {
    return new Promise(() => {});
  }
  kill() {
    this.killed = true;
    this.stdout.end();
    this.stderr.end();
  }
  reply(message: any, result: unknown) {
    this.stdout.push({ id: message.id, result });
  }
  event(method: string, params: unknown) {
    this.stdout.push({ method, params });
  }
}

function server(
  options: {
    ephemeral?: boolean;
    status?: string;
    hold?: boolean;
    error?: string;
  } = {},
) {
  const proc = new FakeProcess();
  proc.onCall = (message) => {
    if (!message.id) return;
    if (options.error === message.method) {
      proc.stdout.push({
        id: message.id,
        error: { code: -32601, message: "Unsupported method" },
      });
      return;
    }
    if (message.method === "model/list") {
      proc.reply(message, {
        data: ["gpt-5.4", "gpt-6-sol"].map((model) => ({
          model,
          displayName: model,
          hidden: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
            "ultra",
          ].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
        })),
        nextCursor: null,
      });
    } else if (message.method === "config/read") {
      proc.reply(message, {
        config: { mcp_servers: { existing: { command: "unused" } } },
      });
    } else if (message.method === "thread/start") {
      proc.reply(message, {
        thread: { id: "thread", ephemeral: options.ephemeral ?? true },
      });
    } else if (message.method === "turn/start") {
      if (options.hold) {
        proc.reply(message, { turn: { id: "turn" } });
        return;
      }
      // Events can precede the turn/start response.
      proc.event("item/agentMessage/delta", {
        threadId: "unrelated",
        itemId: "x",
        delta: "ignored",
      });
      proc.event("item/agentMessage/delta", {
        threadId: "thread",
        itemId: "answer",
        delta: "O",
      });
      proc.event("item/completed", {
        threadId: "thread",
        item: { id: "answer", type: "agentMessage", text: "OK" },
      });
      proc.event("item/reasoning/summaryTextDelta", {
        threadId: "thread",
        delta: "summary",
      });
      for (const totalTokens of [5, 10])
        proc.event("thread/tokenUsage/updated", {
          threadId: "thread",
          tokenUsage: {
            total: { inputTokens: 7, outputTokens: 3, totalTokens },
          },
        });
      proc.event("turn/completed", {
        threadId: "thread",
        turn: {
          id: "turn",
          status: options.status || "completed",
          error:
            options.status === "failed"
              ? { message: "Inference failed" }
              : null,
        },
      });
      proc.reply(message, { turn: { id: "turn" } });
    } else proc.reply(message, {});
  };
  return proc;
}

const messages = [
  { role: "system", content: "Paper context" },
  { role: "user", content: "Old question" },
  { role: "assistant", content: "Old answer" },
  { role: "user", content: "Follow up" },
] as const;
function request() {
  return {
    model: "gpt-5.4",
    messages: messages.map((m) => ({ ...m })),
    onDelta: () => {},
  };
}

async function rejects(task: Promise<unknown>, pattern: RegExp) {
  try {
    await task;
    assert.fail("Expected failure");
  } catch (error) {
    assert.match(String(error), pattern);
  }
}

describe("Codex ephemeral paper chat", function () {
  afterEach(function () {
    return stopCodexRequests();
  });

  for (const level of [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ] as const) {
    it(`bounds saved gpt-6-sol ${level} effort at turn/start`, async function () {
      const proc = server();
      await runCodexChat(
        {
          ...request(),
          model: "gpt-6-sol",
          reasoning: { provider: "openai", level },
        },
        async () => proc,
      );
      assert.equal(
        proc.calls.find((m) => m.method === "thread/start").params.model,
        "gpt-6-sol",
      );
      assert.equal(
        proc.calls.find((m) => m.method === "turn/start").params.effort,
        ["xhigh", "max", "ultra"].includes(level) ? "high" : level,
      );
    });
  }

  it("preserves historical roles, system context and current images", function () {
    const input = buildCodexInput([
      ...request().messages.slice(0, -1),
      {
        role: "user",
        content: [
          { type: "text", text: "Read this figure" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc" },
          },
        ],
      },
    ]);
    assert.equal(input.instructions, "Paper context");
    assert.deepEqual(
      input.history.map((m) => m.role),
      ["user", "assistant"],
    );
    assert.equal(input.history[1].content[0].type, "output_text");
    assert.deepInclude(input.input, {
      type: "image",
      url: "data:image/png;base64,abc",
    });
  });

  it("streams, accounts usage once, restores history and closes the process", async function () {
    const proc = server();
    let text = "";
    const usage: number[] = [];
    let summary = "";
    const result = await runCodexChat(
      {
        ...request(),
        onDelta: (d) => {
          text += d;
        },
        onReasoning: (e) => {
          summary += e.summary;
        },
        onUsage: (u) => usage.push(u.totalTokens),
      },
      async () => proc,
    );
    assert.equal(result, "OK");
    assert.equal(
      proc.calls.find((m) => m.method === "turn/start").params.effort,
      "medium",
    );
    assert.equal(text, "OK");
    assert.equal(summary, "summary");
    assert.deepEqual(usage, [10]);
    const start = proc.calls.find((m) => m.method === "thread/start");
    assert.isTrue(start.params.ephemeral);
    assert.deepEqual(start.params.config.mcp_servers, {
      existing: { enabled: false },
    });
    assert.equal(start.params.baseInstructions, "Paper context");
    assert.equal(
      proc.calls.find((m) => m.method === "thread/inject_items").params.items
        .length,
      2,
    );
    assert.isTrue(proc.killed);
  });

  it("rejects an unavailable model before creating a thread", async function () {
    const proc = server();
    await rejects(
      runCodexChat({ ...request(), model: "removed-model" }, async () => proc),
      /not available/,
    );
    assert.isFalse(proc.calls.some((m) => m.method === "thread/start"));
    assert.isTrue(proc.killed);
  });

  it("never starts inference when ephemeral is not confirmed", async function () {
    const proc = server({ ephemeral: false });
    await rejects(
      runCodexChat(request(), async () => proc),
      /ephemeral/,
    );
    assert.isFalse(proc.calls.some((m) => m.method === "turn/start"));
    assert.isTrue(proc.killed);
  });

  it("fails explicitly on unsupported history injection", async function () {
    const proc = server({ error: "thread/inject_items" });
    await rejects(
      runCodexChat(request(), async () => proc),
      /Unsupported method/,
    );
    assert.isTrue(proc.killed);
  });

  it("does not treat a failed turn with partial text as success", async function () {
    const proc = server({ status: "failed" });
    await rejects(
      runCodexChat(request(), async () => proc),
      /Inference failed/,
    );
    assert.isTrue(proc.killed);
  });

  it("cancels an in-flight turn and closes its process", async function () {
    const proc = server({ hold: true });
    const controller = new AbortController();
    const task = runCodexChat(
      { ...request(), signal: controller.signal },
      async () => proc,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await rejects(task, /Cancelled/);
    assert.isTrue(proc.killed);
  });

  it("does not spawn when already cancelled", async function () {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;
    await rejects(
      runCodexChat({ ...request(), signal: controller.signal }, async () => {
        spawned = true;
        return server();
      }),
      /Cancelled/,
    );
    assert.isFalse(spawned);
  });

  it("closes a process whose launch completes after plugin shutdown", async function () {
    const proc = server();
    let finishSpawn!: (value: CodexProcess) => void;
    const task = runCodexChat(
      request(),
      () =>
        new Promise((resolve) => {
          finishSpawn = resolve;
        }),
    );
    stopCodexRequests();
    finishSpawn(proc);
    await rejects(task, /Plugin shutdown/);
    assert.isTrue(proc.killed);
    assert.isEmpty(proc.calls);
  });

  it("rejects an outstanding request on process EOF", async function () {
    const proc = new FakeProcess();
    const rpc = new CodexRpc(proc);
    const pending = rpc.request("initialize", {});
    proc.stdout.end();
    await rejects(pending, /closed/);
    assert.isTrue(proc.killed);
  });

  it("stops an unsupported server interaction instead of hanging", async function () {
    const proc = server({ hold: true });
    const task = runCodexChat(request(), async () => proc);
    await new Promise((resolve) => setTimeout(resolve, 0));
    proc.stdout.push({
      id: "approval",
      method: "item/commandExecution/requestApproval",
      params: {},
    });
    await rejects(task, /unsupported interaction/);
    assert.isTrue(proc.killed);
  });
});

describe("Codex model discovery", function () {
  const originalZotero = globalThis.Zotero;
  let prefs: Map<string, unknown>;
  beforeEach(function () {
    prefs = new Map();
    globalThis.Zotero = {
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: unknown) => prefs.set(key, value),
      },
    } as unknown as typeof Zotero;
  });
  afterEach(function () {
    stopCodexModelRefresh();
    globalThis.Zotero = originalZotero;
  });

  it("reads every page, filters hidden models, caches capabilities and closes without inference", async function () {
    const proc = new FakeProcess();
    const model = (name: string, hidden = false) => ({
      model: name,
      displayName: name,
      hidden,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["medium", "high", "ultra"].map(
        (reasoningEffort) => ({ reasoningEffort, description: "" }),
      ),
    });
    proc.onCall = (message) => {
      if (!message.id) return;
      if (message.method === "model/list") {
        proc.reply(
          message,
          message.params.cursor === "next"
            ? {
                data: [model("future-model"), model("hidden", true)],
                nextCursor: null,
              }
            : { data: [model("first-model")], nextCursor: "next" },
        );
      } else proc.reply(message, {});
    };
    const first = refreshCodexModels(async () => proc);
    const second = refreshCodexModels(async () => {
      throw new Error("duplicate launch");
    });
    assert.strictEqual(first, second);
    const models = await first;
    assert.deepEqual(
      models.map((m) => m.model),
      ["first-model", "future-model"],
    );
    assert.deepEqual(getCachedCodexModels(), models);
    assert.deepEqual(
      getCodexReasoningOptions("future-model").map((o) => o.level),
      ["medium", "high"],
    );
    assert.equal(resolveCodexEffort(models[0], "low"), "high");
    assert.equal(resolveCodexEffort(models[0], "ultra"), "high");
    assert.isTrue(proc.killed);
    assert.isFalse(
      proc.calls.some(
        (m) => m.method === "thread/start" || m.method === "turn/start",
      ),
    );
    prefs.set(`${config.prefsPrefix}.codexBinaryPath`, "/another/codex");
    assert.deepEqual(getCachedCodexModels(), []);
  });

  it("closes a discovery process launched after plugin shutdown", async function () {
    const proc = server();
    let launch!: (proc: CodexProcess) => void;
    const task = refreshCodexModels(
      () =>
        new Promise((resolve) => {
          launch = resolve;
        }),
    );
    stopCodexModelRefresh();
    launch(proc);
    await rejects(task, /Plugin shutdown/);
    assert.isTrue(proc.killed);
    assert.deepEqual(getCachedCodexModels(), []);
  });

  it("preserves the last catalog on discovery failure and permits retry", async function () {
    await refreshCodexModels(async () => server());
    const cached = getCachedCodexModels();
    const proc = server({ error: "model/list" });
    await rejects(
      refreshCodexModels(async () => proc),
      /Unsupported method/,
    );
    assert.isTrue(proc.killed);
    assert.deepEqual(getCachedCodexModels(), cached);
    assert.deepEqual(await refreshCodexModels(async () => server()), cached);
  });
});
