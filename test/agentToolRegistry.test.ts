import { assert } from "chai";
import { AgentToolRegistry } from "../src/agent/tools/registry";
import type { AgentToolContext } from "../src/agent/types";

describe("AgentToolRegistry", function () {
  const baseContext: AgentToolContext = {
    request: {
      conversationKey: 1,
      mode: "agent",
      userText: "test",
    },
    item: null,
    currentAnswerText: "",
    modelName: "gpt-4o-mini",
  };

  it("returns an error result for unknown tools", async function () {
    const registry = new AgentToolRegistry();
    const result = await registry.prepareExecution(
      {
        id: "call-1",
        name: "missing_tool",
        arguments: {},
      },
      baseContext,
    );

    assert.equal(result.kind, "result");
    if (result.kind !== "result") return;
    assert.equal(result.result.ok, false);
    assert.include(String((result.result.content as { error?: string }).error), "Unknown tool");
  });

  it("gates write tools behind confirmation", async function () {
    const registry = new AgentToolRegistry();
    registry.register({
      spec: {
        name: "save_answer_to_note",
        description: "save note",
        inputSchema: { type: "object" },
        mutability: "write",
        requiresConfirmation: true,
      },
      validate: (args) =>
        typeof (args as { content?: unknown })?.content === "string"
          ? { ok: true, value: { content: (args as { content: string }).content } }
          : { ok: false, error: "content required" },
      createPendingWriteAction: (input) => ({
        toolName: "save_answer_to_note",
        args: input,
        title: "Save note?",
        confirmLabel: "Approve",
        cancelLabel: "Cancel",
        editableContent: input.content,
        saveTargets: [
          { id: "item", label: "Save as item note" },
          { id: "standalone", label: "Save as standalone note" },
        ],
        defaultTargetId: "item",
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
      execute: async (input) => ({ saved: input.content, target: input.target }),
    });

    const result = await registry.prepareExecution(
      {
        id: "call-1",
        name: "save_answer_to_note",
        arguments: { content: "hello" },
      },
      baseContext,
    );

    assert.equal(result.kind, "confirmation");
    if (result.kind !== "confirmation") return;
    assert.equal(result.action.toolName, "save_answer_to_note");
    assert.equal(result.deny().ok, false);
    const approved = await result.execute({
      content: "edited hello",
      target: "standalone",
    });
    assert.equal(approved.ok, true);
    assert.deepEqual(approved.content, {
      saved: "edited hello",
      target: "standalone",
    });
  });

  it("tracks MCP-style resources and prompts separately from tools", function () {
    const registry = new AgentToolRegistry();
    registry.registerResource({
      spec: {
        name: "active_context",
        description: "Current Zotero context",
        uri: "zotero://active-context",
      },
      read: async () => ({ ok: true }),
    });
    registry.registerPrompt({
      spec: {
        name: "paper_summary",
        description: "Summarize a paper",
        arguments: [{ name: "question", description: "User request", required: true }],
      },
      render: async () => "Summarize the paper",
    });

    assert.deepEqual(registry.listTools(), []);
    assert.deepEqual(registry.listResources().map((entry) => entry.name), [
      "active_context",
    ]);
    assert.deepEqual(registry.listPrompts().map((entry) => entry.name), [
      "paper_summary",
    ]);
    assert.equal(registry.getResource("active_context")?.spec.uri, "zotero://active-context");
    assert.equal(registry.getPrompt("paper_summary")?.spec.name, "paper_summary");
  });
});
