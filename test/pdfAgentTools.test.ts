import { assert } from "chai";
import { AgentToolRegistry } from "../src/agent/tools/registry";
import type { AgentToolContext } from "../src/agent/types";
import { createPreparePdfPagesForModelTool } from "../src/agent/tools/read/preparePdfPagesForModel";
import { createPreparePdfFileForModelTool } from "../src/agent/tools/read/preparePdfFileForModel";

function createBaseContext(
  overrides: Partial<AgentToolContext["request"]> = {},
): AgentToolContext {
  return {
    request: {
      conversationKey: 1,
      mode: "agent",
      userText: "check page 3",
      model: "gpt-4.1",
      apiBase: "https://api.openai.com/v1/responses",
      authMode: "api_key",
      ...overrides,
    },
    item: null,
    currentAnswerText: "",
    modelName: "gpt-4.1",
  };
}

describe("PDF agent tools", function () {
  it("bypasses approval when the user explicitly requested the same pages", async function () {
    const registry = new AgentToolRegistry();
    let prepareCallCount = 0;
    registry.register(
      createPreparePdfPagesForModelTool({
        preparePagesForModel: async (params: { pages: number[] }) => {
          prepareCallCount += 1;
          return {
            target: {
              source: "library" as const,
              title: "Paper",
              storedPath: "/tmp/paper.pdf",
              mimeType: "application/pdf",
              contextItemId: 5,
            },
            pages: params.pages.map((pageIndex) => ({
              pageIndex,
              pageLabel: `${pageIndex + 1}`,
              imagePath: `/tmp/page-${pageIndex + 1}.png`,
              contentHash: `hash-${pageIndex + 1}`,
            })),
            artifacts: [],
          };
        },
      } as any),
    );

    const execution = await registry.prepareExecution(
      {
        id: "call-1",
        name: "prepare_pdf_pages_for_model",
        arguments: {
          contextItemId: 5,
          pages: [3],
        },
      },
      createBaseContext(),
    );

    assert.equal(execution.kind, "result");
    assert.equal(prepareCallCount, 1);
  });

  it("requires approval for auto-selected pages and accepts edited page lists", async function () {
    const registry = new AgentToolRegistry();
    registry.register(
      createPreparePdfPagesForModelTool({
        preparePagesForModel: async (params: { pages: number[] }) => ({
          target: {
            source: "library" as const,
            title: "Paper",
            storedPath: "/tmp/paper.pdf",
            mimeType: "application/pdf",
            contextItemId: 5,
          },
          pages: params.pages.map((pageIndex) => ({
            pageIndex,
            pageLabel: `${pageIndex + 1}`,
            imagePath: `/tmp/page-${pageIndex + 1}.png`,
            contentHash: `hash-${pageIndex + 1}`,
          })),
          artifacts: params.pages.map((pageIndex) => ({
            kind: "image" as const,
            mimeType: "image/png",
            storedPath: `/tmp/page-${pageIndex + 1}.png`,
            contentHash: `hash-${pageIndex + 1}`,
            pageIndex,
            pageLabel: `${pageIndex + 1}`,
          })),
        }),
      } as any),
    );

    const execution = await registry.prepareExecution(
      {
        id: "call-1",
        name: "prepare_pdf_pages_for_model",
        arguments: {
          contextItemId: 5,
          pages: [4],
        },
      },
      createBaseContext({
        userText: "Explain the equation in this paper",
      }),
    );

    assert.equal(execution.kind, "confirmation");
    if (execution.kind !== "confirmation") return;
    assert.equal(execution.action.pageSelectionValue, "p4");
    const approved = await execution.execute({
      pages: "p4-5",
    });
    assert.equal(approved.ok, true);
    assert.deepEqual(
      approved.content,
      {
        target: {
          source: "library",
          title: "Paper",
          contextItemId: 5,
          itemId: undefined,
          paperContext: undefined,
        },
        pageCount: 2,
        pages: [
          { pageIndex: 3, pageLabel: "4" },
          { pageIndex: 4, pageLabel: "5" },
        ],
        transport: "page_images",
      },
    );
  });

  it("blocks whole-PDF native input on codex auth", async function () {
    const registry = new AgentToolRegistry();
    registry.register(
      createPreparePdfFileForModelTool({
        preparePdfFileForModel: async () => ({
          target: {
            source: "library" as const,
            title: "Paper",
            storedPath: "/tmp/paper.pdf",
            mimeType: "application/pdf",
            contextItemId: 5,
          },
          artifact: {
            kind: "file_ref" as const,
            mimeType: "application/pdf",
            storedPath: "/tmp/paper.pdf",
            name: "paper.pdf",
          },
        }),
      } as any),
    );

    const execution = await registry.prepareExecution(
      {
        id: "call-1",
        name: "prepare_pdf_file_for_model",
        arguments: {
          contextItemId: 5,
        },
      },
      createBaseContext({
        authMode: "codex_auth",
        apiBase: "https://chatgpt.com/backend-api/codex/responses",
        userText: "Read the whole PDF and answer this question",
      }),
    );

    assert.equal(execution.kind, "confirmation");
    if (execution.kind !== "confirmation") return;
    const result = await execution.execute();
    assert.equal(result.ok, false);
    assert.include(
      String((result.content as { error?: string }).error),
      "Responses-capable non-codex providers",
    );
  });
});
