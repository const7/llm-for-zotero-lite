import { assert } from "chai";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRuntime } from "../src/agent/runtime";
import { AgentToolRegistry } from "../src/agent/tools/registry";
import type {
  AgentEvent,
  AgentModelCapabilities,
  AgentModelStep,
  AgentRuntimeRequest,
} from "../src/agent/types";
import type { AgentModelAdapter, AgentStepParams } from "../src/agent/model/adapter";

type MockDbRow = Record<string, unknown>;

function installMockDb() {
  const runs = new Map<string, MockDbRow>();
  const events: MockDbRow[] = [];
  const originalZotero = (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero;
  (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero = {
    DB: {
      executeTransaction: async (fn: () => Promise<unknown>) => fn(),
      queryAsync: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("INSERT OR REPLACE INTO llm_for_zotero_agent_runs")) {
          runs.set(String(params[0]), {
            runId: params[0],
            conversationKey: params[1],
            mode: params[2],
            modelName: params[3],
            status: params[4],
            createdAt: params[5],
            completedAt: params[6],
            finalText: params[7],
          });
          return [];
        }
        if (sql.includes("UPDATE llm_for_zotero_agent_runs")) {
          const run = runs.get(String(params[3]));
          if (run) {
            run.status = params[0];
            run.completedAt = params[1];
            run.finalText = params[2];
          }
          return [];
        }
        if (sql.includes("INSERT INTO llm_for_zotero_agent_run_events")) {
          events.push({
            runId: params[0],
            seq: params[1],
            eventType: params[2],
            payloadJson: params[3],
            createdAt: params[4],
          });
          return [];
        }
        if (sql.includes("SELECT run_id AS runId") && sql.includes("agent_run_events")) {
          return events
            .filter((entry) => entry.runId === params[0])
            .sort((a, b) => Number(a.seq) - Number(b.seq));
        }
        if (sql.includes("SELECT run_id AS runId") && sql.includes("agent_runs")) {
          const run = runs.get(String(params[0]));
          return run ? [run] : [];
        }
        return [];
      },
    },
  };
  return () => {
    (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero =
      originalZotero;
  };
}

class MockAdapter implements AgentModelAdapter {
  private stepIndex = 0;

  constructor(
    private readonly steps: AgentModelStep[],
    private readonly capabilities: AgentModelCapabilities,
  ) {}

  getCapabilities(_request: AgentRuntimeRequest): AgentModelCapabilities {
    return this.capabilities;
  }

  supportsTools(_request: AgentRuntimeRequest): boolean {
    return this.capabilities.toolCalls;
  }

  async runStep(_params: AgentStepParams): Promise<AgentModelStep> {
    const step = this.steps[this.stepIndex];
    this.stepIndex += 1;
    return step;
  }
}

describe("AgentRuntime", function () {
  it("falls back when the adapter does not support tools", async function () {
    const restoreDb = installMockDb();
    try {
      const runtime = new AgentRuntime({
        registry: new AgentToolRegistry(),
        adapterFactory: () =>
          new MockAdapter([], {
            streaming: false,
            toolCalls: false,
            multimodal: false,
          }),
      });
      const events: AgentEvent[] = [];
      const outcome = await runtime.runTurn({
        request: {
          conversationKey: 1,
          mode: "agent",
          userText: "hello",
          model: "gpt-4o-mini",
          apiBase: "https://api.openai.com/v1/chat/completions",
          apiKey: "test",
        },
        onEvent: (event) => {
          events.push(event);
        },
      });

      assert.equal(outcome.kind, "fallback");
      assert.deepInclude(events[0], {
        type: "fallback",
      });
    } finally {
      restoreDb();
    }
  });

  it("executes tool calls and resumes after approval", async function () {
    const restoreDb = installMockDb();
    try {
      const registry = new AgentToolRegistry();
      registry.register({
        spec: {
          name: "save_answer_to_note",
          description: "save",
          inputSchema: { type: "object" },
          mutability: "write",
          requiresConfirmation: true,
        },
        validate: () => ({ ok: true, value: { content: "hello" } }),
        createPendingWriteAction: () => ({
          toolName: "save_answer_to_note",
          args: { content: "hello" },
          title: "Save hello",
          confirmLabel: "Approve",
          cancelLabel: "Cancel",
        }),
        applyConfirmation: (input, resolutionData) => {
          if (!resolutionData || typeof resolutionData !== "object") {
            return { ok: true, value: input };
          }
          const data = resolutionData as {
            content?: unknown;
            target?: unknown;
          };
          return {
            ok: true,
            value: {
              content:
                typeof data.content === "string" && data.content.trim()
                  ? data.content.trim()
                  : input.content,
              target:
                data.target === "item" || data.target === "standalone"
                  ? data.target
                  : "item",
            },
          };
        },
        execute: async (input) => ({
          status: "created",
          saved: input.content,
          target: input.target,
        }),
      });

      const runtime = new AgentRuntime({
        registry,
        adapterFactory: () =>
          new MockAdapter(
            [
              {
                kind: "tool_calls",
                calls: [
                  {
                    id: "call-1",
                    name: "save_answer_to_note",
                    arguments: { content: "hello" },
                  },
                ],
                assistantMessage: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call-1",
                      name: "save_answer_to_note",
                      arguments: { content: "hello" },
                    },
                  ],
                },
              },
              {
                kind: "final",
                text: "Saved.",
                assistantMessage: {
                  role: "assistant",
                  content: "Saved.",
                },
              },
            ],
            {
              streaming: false,
              toolCalls: true,
              multimodal: false,
            },
          ),
      });

      const events: AgentEvent[] = [];
      const outcomePromise = runtime.runTurn({
        request: {
          conversationKey: 1,
          mode: "agent",
          userText: "save this",
          model: "gpt-4o-mini",
          apiBase: "https://api.openai.com/v1/chat/completions",
          apiKey: "test",
        },
        onEvent: async (event) => {
          events.push(event);
          if (event.type === "confirmation_required") {
            runtime.resolveConfirmation(event.requestId, true, {
              content: "edited hello",
              target: "standalone",
            });
          }
        },
      });
      const outcome = await outcomePromise;

      assert.equal(outcome.kind, "completed");
      if (outcome.kind !== "completed") return;
      assert.equal(outcome.text, "Saved.");
      assert.isTrue(events.some((event) => event.type === "tool_call"));
      assert.isTrue(events.some((event) => event.type === "tool_result"));
      const toolResultEvent = events.find(
        (event) => event.type === "tool_result",
      );
      assert.deepEqual(
        toolResultEvent && toolResultEvent.type === "tool_result"
          ? toolResultEvent.content
          : null,
        {
          status: "created",
          saved: "edited hello",
          target: "standalone",
        },
      );
      assert.isTrue(
        events.some(
          (event) =>
            event.type === "confirmation_resolved" && event.approved === true,
        ),
      );
    } finally {
      restoreDb();
    }
  });

  it("passes image artifacts back into the next model step", async function () {
    const restoreDb = installMockDb();
    const restoreIOUtils = (
      globalThis as typeof globalThis & {
        IOUtils?: { read?: (path: string) => Promise<Uint8Array> };
        btoa?: (value: string) => string;
      }
    ).IOUtils;
    const restoreBtoa = (
      globalThis as typeof globalThis & { btoa?: (value: string) => string }
    ).btoa;
    const tempDir = mkdtempSync(join(tmpdir(), "llm-zotero-agent-runtime-"));
    const imagePath = join(tempDir, "page.png");
    writeFileSync(imagePath, Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]));
    try {
      (
        globalThis as typeof globalThis & {
          IOUtils?: { read?: (path: string) => Promise<Uint8Array> };
        }
      ).IOUtils = {
        read: async (path: string) => new Uint8Array(readFileSync(path)),
      };
      (
        globalThis as typeof globalThis & {
          btoa?: (value: string) => string;
        }
      ).btoa = (value: string) => Buffer.from(value, "binary").toString("base64");

      const registry = new AgentToolRegistry();
      registry.register({
        spec: {
          name: "prepare_pdf_pages_for_model",
          description: "prepare pages",
          inputSchema: { type: "object" },
          mutability: "read",
          requiresConfirmation: false,
        },
        validate: () => ({ ok: true, value: {} }),
        execute: async () => ({
          content: { pageCount: 1 },
          artifacts: [
            {
              kind: "image" as const,
              mimeType: "image/png",
              storedPath: imagePath,
              contentHash: "hash-1",
              pageIndex: 2,
              pageLabel: "3",
              title: "Paper - page 3",
            },
          ],
        }),
      });

      let sawArtifactUserMessage = false;
      const runtime = new AgentRuntime({
        registry,
        adapterFactory: () => ({
          getCapabilities: () => ({
            streaming: false,
            toolCalls: true,
            multimodal: true,
          }),
          supportsTools: () => true,
          async runStep(params: AgentStepParams): Promise<AgentModelStep> {
            if (!sawArtifactUserMessage) {
              sawArtifactUserMessage = params.messages.some(
                (message) =>
                  message.role === "user" &&
                  Array.isArray(message.content) &&
                  message.content.some(
                    (part) =>
                      part.type === "image_url" &&
                      part.image_url.url.startsWith("data:image/png;base64,"),
                  ),
              );
              if (!sawArtifactUserMessage) {
                return {
                  kind: "tool_calls",
                  calls: [
                    {
                      id: "call-1",
                      name: "prepare_pdf_pages_for_model",
                      arguments: {},
                    },
                  ],
                  assistantMessage: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call-1",
                        name: "prepare_pdf_pages_for_model",
                        arguments: {},
                      },
                    ],
                  },
                };
              }
            }
            return {
              kind: "final",
              text: "Done.",
              assistantMessage: {
                role: "assistant",
                content: "Done.",
              },
            };
          },
        }),
      });

      const outcome = await runtime.runTurn({
        request: {
          conversationKey: 1,
          mode: "agent",
          userText: "Explain the figure",
          model: "gpt-4.1",
          apiBase: "https://api.openai.com/v1/chat/completions",
          apiKey: "test",
        },
      });

      assert.equal(outcome.kind, "completed");
      assert.isTrue(sawArtifactUserMessage);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      (
        globalThis as typeof globalThis & {
          IOUtils?: { read?: (path: string) => Promise<Uint8Array> };
        }
      ).IOUtils = restoreIOUtils;
      (
        globalThis as typeof globalThis & { btoa?: (value: string) => string }
      ).btoa = restoreBtoa;
      restoreDb();
    }
  });
});
