import { assert } from "chai";
import { createReadPaperExcerptTool } from "../src/agent/tools/read/readPaperExcerpt";

describe("readPaperExcerpt tool", function () {
  it("accepts zero-based chunk indexes returned by retrieval", async function () {
    let capturedChunkIndex: number | null = null;
    const tool = createReadPaperExcerptTool({
      getChunkExcerpt: async (input: {
        paperContext: { itemId: number; contextItemId: number; title: string };
        chunkIndex: number;
      }) => {
        capturedChunkIndex = input.chunkIndex;
        return {
          text: "Excerpt",
          chunkIndex: input.chunkIndex,
          totalChunks: 3,
          paperContext: input.paperContext,
        };
      },
    } as any);

    const validated = tool.validate({
      paperContext: {
        itemId: 1,
        contextItemId: 11,
        title: "TEM",
      },
      chunkIndex: 0,
    });

    assert.isTrue(validated.ok);
    if (!validated.ok) return;
    const result = await tool.execute(validated.value, {} as any);
    assert.equal(capturedChunkIndex, 0);
    assert.deepInclude(result as Record<string, unknown>, {
      text: "Excerpt",
      chunkIndex: 0,
      totalChunks: 3,
    });
    assert.deepInclude((result as { paperContext: Record<string, unknown> }).paperContext, {
      itemId: 1,
      contextItemId: 11,
      title: "TEM",
    });
  });
});
