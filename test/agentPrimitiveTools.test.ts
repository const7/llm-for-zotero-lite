import { assert } from "chai";
import { buildAgentInitialMessages } from "../src/agent/model/messageBuilder";
import { EDITABLE_ARTICLE_METADATA_FIELDS } from "../src/agent/services/zoteroGateway";
import { clearUndoStack, peekUndoEntry } from "../src/agent/store/undoStore";
import { createQueryLibraryTool } from "../src/agent/tools/read/queryLibrary";
import { createReadLibraryTool } from "../src/agent/tools/read/readLibrary";
import { createEditCurrentNoteTool } from "../src/agent/tools/write/editCurrentNote";
import { createMutateLibraryTool } from "../src/agent/tools/write/mutateLibrary";
import type { AgentToolContext } from "../src/agent/types";

function makeMetadataSnapshot(itemId: number, title: string) {
  return {
    itemId,
    itemType: "journalArticle",
    title,
    fields: Object.fromEntries(
      EDITABLE_ARTICLE_METADATA_FIELDS.map((field) => [field, ""]),
    ) as Record<(typeof EDITABLE_ARTICLE_METADATA_FIELDS)[number], string>,
    creators: [],
  };
}

describe("primitive agent tools", function () {
  const baseContext: AgentToolContext = {
    request: {
      conversationKey: 42,
      mode: "agent",
      userText: "organize the library",
      activeItemId: 9,
      libraryID: 1,
    },
    item: null,
    currentAnswerText: "",
    modelName: "gpt-5.4",
  };

  afterEach(function () {
    clearUndoStack(baseContext.request.conversationKey);
  });

  it("query_library searches items and enriches requested fields", async function () {
    const tool = createQueryLibraryTool({
      resolveLibraryID: () => 1,
      searchAllLibraryItems: async () =>
        [
          {
            itemId: 99,
            itemType: "journalArticle",
            title: "Example Paper",
            firstCreator: "Alice Example",
            year: "2021",
            attachments: [{ contextItemId: 501, title: "PDF" }],
            tags: ["review"],
            collectionIds: [11],
          },
        ] as any,
      getPaperTargetsByItemIds: () => [
        {
          itemId: 99,
          title: "Example Paper",
          firstCreator: "Alice Example",
          year: "2021",
          attachments: [{ contextItemId: 501, title: "PDF" }],
          tags: ["review"],
          collectionIds: [11],
        },
      ],
      getEditableArticleMetadata: () => makeMetadataSnapshot(99, "Example Paper"),
      getItem: () => ({ id: 99 }) as any,
      getActiveContextItem: () => null,
      listCollectionSummaries: () => [],
      listLibraryPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      listUnfiledPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      listUntaggedPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      listCollectionPaperTargets: async () => ({
        collection: { collectionId: 11, name: "Biology", libraryID: 1 },
        papers: [],
        totalCount: 0,
      }),
      findRelatedPapersInLibrary: async () => ({
        referenceTitle: "Ref",
        relatedPapers: [],
      }),
      detectDuplicatesInLibrary: async () => ({
        totalGroups: 0,
        groups: [],
      }),
      getCollectionSummary: (collectionId: number) =>
        collectionId === 11
          ? {
              collectionId: 11,
              name: "Biology",
              libraryID: 1,
              path: "Biology",
            }
          : null,
    } as never);

    const validated = tool.validate({
      entity: "items",
      mode: "search",
      text: "example",
      include: ["metadata", "attachments", "tags", "collections"],
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, baseContext);
    assert.deepEqual((result as { warnings: unknown[] }).warnings, []);
    const first = (result as { results: Array<Record<string, unknown>> }).results[0];
    assert.equal(first.itemId, 99);
    assert.equal((first.metadata as { title?: string }).title, "Example Paper");
    assert.deepEqual(first.attachments, [{ contextItemId: 501, title: "PDF" }]);
    assert.deepEqual(first.tags, ["review"]);
    assert.deepEqual(first.collections, [
      { collectionId: 11, name: "Biology", libraryID: 1, path: "Biology" },
    ]);
  });

  it("query_library related mode resolves the active paper from reader context", async function () {
    let receivedReferenceItemId = 0;
    const tool = createQueryLibraryTool({
      resolveLibraryID: () => 1,
      listPaperContexts: () => [
        {
          itemId: 77,
          contextItemId: 2000000001,
          title: "Reader Context Paper",
        },
      ],
      getActivePaperContext: () => ({
        itemId: 77,
        contextItemId: 2000000001,
        title: "Reader Context Paper",
      }),
      getItem: () => null,
      findRelatedPapersInLibrary: async ({ referenceItemId }: { referenceItemId: number }) => {
        receivedReferenceItemId = referenceItemId;
        return {
          referenceTitle: "Reader Context Paper",
          relatedPapers: [
            {
              itemId: 88,
              title: "Nearby Paper",
              firstCreator: "Dana Example",
              year: "2022",
              attachments: [],
              tags: [],
              collectionIds: [],
              matchScore: 0.72,
              matchReasons: ["title_overlap"],
            },
          ],
        };
      },
      getEditableArticleMetadata: () => null,
      listCollectionSummaries: () => [],
      listLibraryPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      listUnfiledPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      listUntaggedPaperTargets: async () => ({ papers: [], totalCount: 0 }),
      listCollectionPaperTargets: async () => ({
        collection: { collectionId: 11, name: "Biology", libraryID: 1 },
        papers: [],
        totalCount: 0,
      }),
      searchLibraryItems: async () => [],
      detectDuplicatesInLibrary: async () => ({
        totalGroups: 0,
        groups: [],
      }),
      getCollectionSummary: () => null,
      getPaperTargetsByItemIds: () => [],
    } as never);

    const validated = tool.validate({
      entity: "items",
      mode: "related",
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, {
      ...baseContext,
      request: {
        ...baseContext.request,
        activeItemId: 2000000001,
      },
    });
    assert.equal(receivedReferenceItemId, 77);
    assert.equal((result as { referenceItemId: number }).referenceItemId, 77);
    assert.lengthOf((result as { results: unknown[] }).results, 1);
  });

  it("read_library returns item state keyed by itemId", async function () {
    const fakeItem = {
      id: 7,
      getDisplayTitle: () => "Paper Seven",
    } as any;
    const tool = createReadLibraryTool({
      listPaperContexts: () => [],
      getPaperTargetsByItemIds: () => [
        {
          itemId: 7,
          title: "Paper Seven",
          firstCreator: "Dana Example",
          year: "2020",
          attachments: [{ contextItemId: 701, title: "Main PDF", contentType: "application/pdf" }],
          tags: ["alpha"],
          collectionIds: [12],
        },
      ],
      getItem: () => fakeItem,
      resolveMetadataItem: () => fakeItem,
      getEditableArticleMetadata: () => makeMetadataSnapshot(7, "Paper Seven"),
      getPaperNotes: () => [
        {
          noteId: 801,
          title: "Summary",
          noteText: "Important note",
          wordCount: 2,
        },
      ],
      getPaperAnnotations: () => [
        {
          annotationId: 901,
          type: "highlight",
          text: "Key line",
        },
      ],
      getAllChildAttachmentInfos: async () => [
        { contextItemId: 701, title: "Main PDF", contentType: "application/pdf" },
      ],
      getCollectionSummary: () => ({
        collectionId: 12,
        name: "Reading",
        libraryID: 1,
        path: "Reading",
      }),
    } as never);

    const validated = tool.validate({
      itemIds: [7],
      sections: ["metadata", "notes", "annotations", "attachments", "collections"],
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, baseContext);
    const entry = (result as { results: Record<string, any> }).results["7"];
    assert.equal(entry.title, "Paper Seven");
    assert.lengthOf(entry.notes, 1);
    assert.lengthOf(entry.annotations, 1);
    assert.deepEqual(entry.attachments, [{ contextItemId: 701, title: "Main PDF", contentType: "application/pdf" }]);
    assert.deepEqual(entry.collections, [
      { collectionId: 12, name: "Reading", libraryID: 1, path: "Reading" },
    ]);
  });

  it("mutate_library lets confirmation skip individual operations and records undo", async function () {
    const appliedCalls: string[] = [];
    const tool = createMutateLibraryTool({
      resolveMetadataItem: () => null,
      getEditableArticleMetadata: () => null,
      applyTagAssignments: async () => {
        appliedCalls.push("apply_tags");
        return {
          selectedCount: 1,
          updatedCount: 1,
          skippedCount: 0,
          items: [
            {
              itemId: 10,
              title: "Paper Ten",
              status: "updated",
              addedTags: ["ml"],
              skippedTags: [],
            },
          ],
        };
      },
      removeTagsFromItem: async () => {
        appliedCalls.push("remove_tags_undo");
      },
      getCollectionSummary: () => null,
      createCollection: async () => {
        appliedCalls.push("create_collection");
        return {
          collectionId: 21,
          name: "New Folder",
          libraryID: 1,
          path: "New Folder",
        };
      },
      deleteCollection: async () => {
        appliedCalls.push("delete_collection_undo");
      },
      saveAnswerToNote: async () => "created" as const,
      importPapersByIdentifiers: async () => ({ succeeded: 1, failed: 0 }),
      addItemsToCollections: async () => ({
        selectedCount: 0,
        movedCount: 0,
        skippedCount: 0,
        collections: [],
        items: [],
      }),
      removeItemFromCollection: async () => undefined,
      addItemsToCollection: async () => ({
        selectedCount: 0,
        movedCount: 0,
        skippedCount: 0,
        collection: { collectionId: 1, name: "X", libraryID: 1 },
        items: [],
      }),
      updateArticleMetadata: async () => ({
        status: "updated" as const,
        itemId: 1,
        title: "X",
        changedFields: ["title"],
      }),
      getItem: () => null,
      applyTagsToItems: async () => ({
        selectedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        items: [],
      }),
    } as never);

    const validated = tool.validate({
      operations: [
        { type: "apply_tags", itemIds: [10], tags: ["ml"] },
        { type: "create_collection", name: "New Folder" },
      ],
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const pending = await tool.createPendingAction?.(validated.value, baseContext);
    assert.exists(pending);
    assert.deepEqual(pending?.fields.map((field) => field.id), [
      "selectedOperations",
      "operationsJson",
    ]);

    const confirmed = tool.applyConfirmation?.(
      validated.value,
      {
        selectedOperations: [{ id: "op-1", checked: true }],
        operationsJson: JSON.stringify(validated.value.operations, null, 2),
      },
      baseContext,
    );
    assert.isTrue(confirmed?.ok);
    if (!confirmed?.ok) return;
    assert.lengthOf(confirmed.value.operations, 1);

    const result = await tool.execute(confirmed.value, baseContext);
    assert.deepEqual(appliedCalls, ["apply_tags"]);
    assert.equal((result as { appliedCount: number }).appliedCount, 1);
    const undo = peekUndoEntry(baseContext.request.conversationKey);
    assert.exists(undo);
    await undo?.revert();
    assert.deepEqual(appliedCalls, ["apply_tags", "remove_tags_undo"]);
  });

  it("mutate_library can collect destination folders for unresolved move operations", async function () {
    const moveCalls: Array<{ itemId: number; targetCollectionId: number }> = [];
    const tool = createMutateLibraryTool({
      resolveLibraryID: () => 1,
      listCollectionSummaries: () => [
        {
          collectionId: 11,
          name: "Memory",
          libraryID: 1,
          path: "Memory",
        },
        {
          collectionId: 12,
          name: "Representation_Drift",
          libraryID: 1,
          path: "Representation_Drift",
        },
      ],
      getPaperTargetsByItemIds: (itemIds: number[]) =>
        itemIds.map((itemId) => ({
          itemId,
          title: `Paper ${itemId}`,
          firstCreator: "Author Example",
          year: "2024",
          attachments: [],
          tags: [],
          collectionIds: [],
        })),
      getCollectionSummary: (collectionId: number) =>
        collectionId === 11
          ? {
              collectionId: 11,
              name: "Memory",
              libraryID: 1,
              path: "Memory",
            }
          : collectionId === 12
            ? {
                collectionId: 12,
                name: "Representation_Drift",
                libraryID: 1,
                path: "Representation_Drift",
              }
            : null,
      addItemsToCollections: async ({ assignments }: { assignments: Array<{ itemId: number; targetCollectionId: number }> }) => {
        moveCalls.push(...assignments);
        return {
          selectedCount: assignments.length,
          movedCount: assignments.length,
          skippedCount: 0,
          collections: assignments.map((assignment) =>
            assignment.targetCollectionId === 11
              ? {
                  collectionId: 11,
                  name: "Memory",
                  libraryID: 1,
                  path: "Memory",
                }
              : {
                  collectionId: 12,
                  name: "Representation_Drift",
                  libraryID: 1,
                  path: "Representation_Drift",
                },
          ),
          items: assignments.map((assignment) => ({
            itemId: assignment.itemId,
            title: `Paper ${assignment.itemId}`,
            status: "moved" as const,
            targetCollectionId: assignment.targetCollectionId,
            targetCollectionName:
              assignment.targetCollectionId === 11
                ? "Memory"
                : "Representation_Drift",
          })),
        };
      },
      removeItemFromCollection: async () => undefined,
      resolveMetadataItem: () => null,
      getEditableArticleMetadata: () => null,
      createCollection: async () => {
        throw new Error("not used");
      },
      deleteCollection: async () => undefined,
      saveAnswerToNote: async () => "created" as const,
      importPapersByIdentifiers: async () => ({ succeeded: 0, failed: 0 }),
      addItemsToCollection: async () => ({
        selectedCount: 0,
        movedCount: 0,
        skippedCount: 0,
        collection: { collectionId: 0, name: "", libraryID: 1 },
        items: [],
      }),
      updateArticleMetadata: async () => ({
        status: "updated" as const,
        itemId: 1,
        title: "X",
        changedFields: ["title"],
      }),
      getItem: () => null,
      applyTagAssignments: async () => ({
        selectedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        items: [],
      }),
      removeTagsFromItem: async () => undefined,
      applyTagsToItems: async () => ({
        selectedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        items: [],
      }),
    } as never);

    const validated = tool.validate({
      operations: [{ type: "move_to_collection", itemIds: [31, 32] }],
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const pending = await tool.createPendingAction?.(validated.value, baseContext);
    assert.exists(pending);
    const moveField = pending?.fields.find(
      (field) => field.id === "moveAssignments:op-1",
    ) as Extract<(typeof pending)["fields"][number], { type: "assignment_table" }> | undefined;
    assert.exists(moveField);
    assert.equal(moveField?.type, "assignment_table");
    assert.deepEqual(
      moveField?.rows.map((row) => row.id),
      ["31", "32"],
    );

    const confirmed = tool.applyConfirmation?.(
      validated.value,
      {
        selectedOperations: [{ id: "op-1", checked: true }],
        operationsJson: JSON.stringify(validated.value.operations, null, 2),
        "moveAssignments:op-1": [
          { id: "31", checked: true, value: "11" },
          { id: "32", checked: true, value: "12" },
        ],
      },
      baseContext,
    );
    assert.isTrue(confirmed?.ok);
    if (!confirmed?.ok) return;
    assert.lengthOf(confirmed.value.operations, 1);
    const moveOperation = confirmed.value.operations[0];
    assert.equal(moveOperation.type, "move_to_collection");
    assert.deepEqual((moveOperation as any).assignments, [
      { itemId: 31, targetCollectionId: 11 },
      { itemId: 32, targetCollectionId: 12 },
    ]);

    const result = await tool.execute(confirmed.value, baseContext);
    assert.equal((result as { appliedCount: number }).appliedCount, 1);
    assert.deepEqual(moveCalls, [
      { itemId: 31, targetCollectionId: 11 },
      { itemId: 32, targetCollectionId: 12 },
    ]);
  });

  it("mutate_library accepts singular move operation payloads from the model", function () {
    const tool = createMutateLibraryTool({
      getCollectionSummary: () => null,
    } as never);

    const validatedFromOperation = tool.validate({
      operation: {
        type: "move_to_collection",
        items: [41, 42],
        folderName: "Memory",
      },
    });
    assert.isTrue(validatedFromOperation.ok);
    if (!validatedFromOperation.ok) return;
    assert.lengthOf(validatedFromOperation.value.operations, 1);
    assert.deepEqual((validatedFromOperation.value.operations[0] as any).itemIds, [
      41,
      42,
    ]);

    const validatedFromTopLevel = tool.validate({
      type: "move_to_collection",
      itemId: 43,
      folderId: 12,
    });
    assert.isTrue(validatedFromTopLevel.ok);
    if (!validatedFromTopLevel.ok) return;
    assert.lengthOf(validatedFromTopLevel.value.operations, 1);
    assert.deepEqual((validatedFromTopLevel.value.operations[0] as any).itemIds, [43]);
    assert.equal(
      (validatedFromTopLevel.value.operations[0] as any).targetCollectionId,
      12,
    );
  });

  it("builds system instructions around the primitive tool names", async function () {
    const messages = await buildAgentInitialMessages(
      {
        conversationKey: 1,
        mode: "agent",
        userText: "Summarize this paper",
        selectedPaperContexts: [
          { itemId: 1, contextItemId: 101, title: "Paper One" },
        ],
      },
      [],
    );
    const systemText =
      typeof messages[0]?.content === "string" ? messages[0].content : "";
    assert.include(systemText, "search_literature_online");
    assert.include(systemText, "query_library");
    assert.include(systemText, "read_library");
    assert.include(systemText, "inspect_pdf");
    assert.include(systemText, "mutate_library");
    assert.include(
      systemText,
      "the search_literature_online review card is the deliverable",
    );
    assert.notInclude(systemText, "search_related_papers_online");
    assert.notInclude(systemText, "read_paper_front_matter");
  });

  it("adds direct-card guidance for unfiled filing requests", async function () {
    const messages = await buildAgentInitialMessages(
      {
        conversationKey: 2,
        mode: "agent",
        userText: "can you help me move the unfiled items to folders?",
      },
      [
        createQueryLibraryTool({} as never),
        createMutateLibraryTool({} as never),
      ],
    );
    const systemText =
      typeof messages[0]?.content === "string" ? messages[0].content : "";
    assert.include(
      systemText,
      "the mutate_library confirmation card is the deliverable",
    );
    assert.include(
      systemText,
      "mutate_library with operations:[{type:'move_to_collection', itemIds:[...]}]",
    );
    assert.include(
      systemText,
      "let the confirmation card collect the target folders",
    );
  });

  it("edit_current_note confirms, updates the active note, and records undo", async function () {
    let restoredHtml: { noteId: number; html: string } | null = null;
    const tool = createEditCurrentNoteTool({
      getActiveNoteSnapshot: () => ({
        noteId: 55,
        title: "Draft Note",
        html: "<p>Original body</p>",
        text: "Original body",
        libraryID: 1,
        noteKind: "standalone",
      }),
      replaceCurrentNote: async ({
        content,
        expectedOriginalHtml,
      }: {
        content: string;
        expectedOriginalHtml?: string;
      }) => {
        assert.equal(expectedOriginalHtml, "<p>Original body</p>");
        return {
          noteId: 55,
          title: "Draft Note",
          previousHtml: "<p>Original body</p>",
          previousText: "Original body",
          nextText: content,
        };
      },
      restoreNoteHtml: async (params: { noteId: number; html: string }) => {
        restoredHtml = params;
      },
    } as never);
    const noteRequest = {
      ...baseContext.request,
      activeNoteContext: {
        noteId: 55,
        title: "Draft Note",
        noteKind: "standalone" as const,
        noteText: "Original body",
      },
    };

    assert.isFalse(Boolean(tool.isAvailable?.(baseContext.request)));
    assert.isTrue(Boolean(tool.isAvailable?.(noteRequest)));

    const validated = tool.validate({
      content: "Rewritten body",
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const pending = tool.createPendingAction?.(validated.value, {
      ...baseContext,
      request: noteRequest,
    });
    assert.exists(pending);
    assert.deepEqual(
      pending?.fields.map((field) => field.type),
      ["diff_preview", "textarea"],
    );
    assert.equal(pending?.mode, "review");
    const reviewField = pending?.fields[0] as Extract<
      NonNullable<typeof pending>["fields"][number],
      { type: "diff_preview" }
    >;
    assert.equal(reviewField.before, "Original body");
    assert.equal(reviewField.after, "Rewritten body");
    assert.equal(reviewField.sourceFieldId, "content");

    const confirmed = tool.applyConfirmation?.(
      validated.value,
      { content: "Approved final note text" },
      {
        ...baseContext,
        request: noteRequest,
      },
    );
    assert.isTrue(confirmed?.ok);
    if (!confirmed?.ok) return;

    const result = await tool.execute(confirmed.value, {
      ...baseContext,
      request: noteRequest,
    });
    assert.deepEqual(result, {
      status: "updated",
      noteId: 55,
      title: "Draft Note",
      noteText: "Approved final note text",
    });

    const undoEntry = peekUndoEntry(baseContext.request.conversationKey);
    assert.exists(undoEntry);
    await undoEntry?.revert();
    assert.deepEqual(restoredHtml, {
      noteId: 55,
      html: "<p>Original body</p>",
    });
  });

  it("edit_current_note normalizes HTML note content before review and save", async function () {
    const tool = createEditCurrentNoteTool({
      getActiveNoteSnapshot: () => ({
        noteId: 55,
        title: "",
        html: "<div><p></p></div>",
        text: "",
        libraryID: 1,
        noteKind: "standalone",
      }),
      replaceCurrentNote: async ({
        content,
      }: {
        content: string;
      }) => {
        assert.equal(content, "Approved *note*");
        return {
          noteId: 55,
          title: "",
          previousHtml: "<div><p></p></div>",
          previousText: "",
          nextText: content,
        };
      },
      restoreNoteHtml: async () => {},
    } as never);
    const noteRequest = {
      ...baseContext.request,
      activeNoteContext: {
        noteId: 55,
        title: "",
        noteKind: "standalone" as const,
        noteText: "",
      },
    };

    const validated = tool.validate({
      content: "<h1>Summary</h1><p><strong>Key point</strong></p>",
    });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;
    assert.equal(validated.value.content, "# Summary\n\n**Key point**");

    const pending = tool.createPendingAction?.(validated.value, {
      ...baseContext,
      request: noteRequest,
    });
    assert.exists(pending);
    assert.include(pending?.description || "", '"Untitled note"');
    const diffField = pending?.fields[0] as Extract<
      NonNullable<typeof pending>["fields"][number],
      { type: "diff_preview" }
    >;
    assert.equal(diffField.before, "");
    assert.equal(diffField.after, "# Summary\n\n**Key point**");
    assert.equal(diffField.emptyMessage, "No note changes yet.");
    const textareaField = pending?.fields[1] as Extract<
      NonNullable<typeof pending>["fields"][number],
      { type: "textarea" }
    >;
    assert.equal(textareaField.value, "# Summary\n\n**Key point**");

    const confirmed = tool.applyConfirmation?.(
      validated.value,
      { content: "<p>Approved <em>note</em></p>" },
      {
        ...baseContext,
        request: noteRequest,
      },
    );
    assert.isTrue(confirmed?.ok);
    if (!confirmed?.ok) return;
    assert.equal(confirmed.value.content, "Approved *note*");

    const result = await tool.execute(confirmed.value, {
      ...baseContext,
      request: noteRequest,
    });
    assert.equal((result as { noteText: string }).noteText, "Approved *note*");
  });

  it("includes the active note content in agent prompts", async function () {
    const messages = await buildAgentInitialMessages(
      {
        conversationKey: 7,
        mode: "agent",
        userText: "Revise the note",
        activeItemId: 55,
        activeNoteContext: {
          noteId: 55,
          title: "Draft Note",
          noteKind: "item",
          parentItemId: 9,
          noteText: "Current note body",
        },
      },
      [],
    );
    const userMessage = messages[messages.length - 1];
    const userText =
      typeof userMessage?.content === "string" ? userMessage.content : "";
    assert.include(userText, "Active note: Draft Note");
    assert.include(userText, "Active note parent item ID: 9");
    assert.include(userText, "Current note content for this turn");
    assert.include(userText, "Current note body");
  });
});
