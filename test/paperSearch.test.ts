import { assert } from "chai";
import {
  invalidatePaperSearchCache,
  searchPaperCandidates,
} from "../src/modules/contextPanel/paperSearch";

type MockCreator = _ZoteroTypes.Item.Creator;

type MockRegularItemOptions = {
  id: number;
  libraryID?: number;
  title: string;
  shortTitle?: string;
  citationKey?: string;
  doi?: string;
  firstCreator?: string;
  creators?: MockCreator[];
  date?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  proceedingsTitle?: string;
  conferenceName?: string;
  dateModified?: string;
  attachmentIDs?: number[];
};

type MockAttachmentOptions = {
  id: number;
  title?: string;
  filename?: string;
};

type MockItem = Zotero.Item & {
  attachmentFilename?: string;
};

function makeCreator(firstName: string, lastName: string): MockCreator {
  return {
    firstName,
    lastName,
    fieldMode: 0,
    creatorTypeID: 8 as keyof _ZoteroTypes.Item.CreatorTypeMapping,
  };
}

function makeRegularItem(options: MockRegularItemOptions): MockItem {
  const {
    id,
    libraryID = 1,
    title,
    shortTitle,
    citationKey,
    doi,
    firstCreator,
    creators = [],
    date,
    publicationTitle,
    journalAbbreviation,
    proceedingsTitle,
    conferenceName,
    dateModified = "2025-01-01T00:00:00Z",
    attachmentIDs = [],
  } = options;
  const fields = {
    title,
    shortTitle: shortTitle || "",
    citationKey: citationKey || "",
    DOI: doi || "",
    firstCreator: firstCreator || "",
    date: date || "",
    publicationTitle: publicationTitle || "",
    journalAbbreviation: journalAbbreviation || "",
    proceedingsTitle: proceedingsTitle || "",
    conferenceName: conferenceName || "",
  };
  return {
    id,
    key: `ITEM-${id}`,
    libraryID,
    dateModified,
    firstCreator: firstCreator || "",
    parentID: undefined,
    attachmentContentType: "",
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => attachmentIDs,
    getCollections: () => [],
    getField: (field: string) => fields[field as keyof typeof fields] || "",
    getCreators: () => creators,
  } as unknown as MockItem;
}

function makeAttachment(options: MockAttachmentOptions): MockItem {
  const { id, title = "", filename = "" } = options;
  return {
    id,
    key: `ATTACH-${id}`,
    libraryID: 1,
    dateModified: "2025-01-01T00:00:00Z",
    attachmentContentType: "application/pdf",
    attachmentFilename: filename,
    isAttachment: () => true,
    isRegularItem: () => false,
    getAttachments: () => [],
    getCollections: () => [],
    getField: (field: string) => (field === "title" ? title : ""),
    getCreators: () => [],
  } as unknown as MockItem;
}

describe("paperSearch", function () {
  const originalZotero = globalThis.Zotero;
  const originalToolkit = (globalThis as typeof globalThis & { ztoolkit?: any })
    .ztoolkit;

  let itemsById: Map<number, MockItem>;
  let getAllCount = 0;

  const installMockZotero = () => {
    (globalThis as typeof globalThis & { Zotero: typeof Zotero }).Zotero = {
      Items: {
        getAll: async () => {
          getAllCount += 1;
          return Array.from(itemsById.values()) as Zotero.Item[];
        },
        get: (id: number) => itemsById.get(id) || null,
      },
    } as typeof Zotero;
    (globalThis as typeof globalThis & { ztoolkit: { log: () => void } })
      .ztoolkit = {
      log: () => {},
    };
  };

  beforeEach(function () {
    itemsById = new Map<number, MockItem>();
    getAllCount = 0;
    invalidatePaperSearchCache();
    installMockZotero();
  });

  after(function () {
    (globalThis as typeof globalThis & { Zotero?: typeof Zotero }).Zotero =
      originalZotero;
    (
      globalThis as typeof globalThis & { ztoolkit?: typeof originalToolkit }
    ).ztoolkit = originalToolkit;
  });

  it("finds multi-token queries by title, year, and any author", async function () {
    itemsById.set(
      1,
      makeRegularItem({
        id: 1,
        title: "Attention Is All You Need",
        citationKey: "Vaswani2017",
        firstCreator: "Ashish Vaswani",
        creators: [makeCreator("Ashish", "Vaswani"), makeCreator("Noam", "Shazeer")],
        date: "2017-06-01",
        publicationTitle: "NeurIPS",
        attachmentIDs: [101],
      }),
    );
    itemsById.set(101, makeAttachment({ id: 101, title: "Main PDF" }));
    itemsById.set(
      2,
      makeRegularItem({
        id: 2,
        title: "Transformers in Vision",
        firstCreator: "Ada Lovelace",
        creators: [makeCreator("Ada", "Lovelace")],
        date: "2021-03-02",
        attachmentIDs: [102],
      }),
    );
    itemsById.set(102, makeAttachment({ id: 102, title: "Vision Transformer" }));

    const results = await searchPaperCandidates(1, "transformer 2017 shazeer");

    assert.isAtLeast(results.length, 1);
    assert.equal(results[0].itemId, 1);
    assert.lengthOf(results[0].attachments, 1);
  });

  it("normalizes punctuation and diacritics for search", async function () {
    itemsById.set(
      3,
      makeRegularItem({
        id: 3,
        title: "Graph-Neural Networks: A Survey",
        firstCreator: "Jose Garcia Marquez",
        creators: [makeCreator("José", "García Márquez")],
        date: "2022",
        attachmentIDs: [103],
      }),
    );
    itemsById.set(103, makeAttachment({ id: 103, title: "Survey PDF" }));

    const punctuationResults = await searchPaperCandidates(
      1,
      "graph neural networks",
    );
    const diacriticResults = await searchPaperCandidates(1, "garcia marquez");

    assert.equal(punctuationResults[0]?.itemId, 3);
    assert.equal(diacriticResults[0]?.itemId, 3);
  });

  it("matches compact @ queries against spaced titles", async function () {
    itemsById.set(
      31,
      makeRegularItem({
        id: 31,
        title: "Working Memory Dynamics",
        firstCreator: "Ava Example",
        attachmentIDs: [131],
      }),
    );
    itemsById.set(131, makeAttachment({ id: 131, title: "Working Memory PDF" }));

    const results = await searchPaperCandidates(1, "workingmemory");

    assert.equal(results[0]?.itemId, 31);
  });

  it("supports DOI lookup while excluding papers without PDFs", async function () {
    itemsById.set(
      4,
      makeRegularItem({
        id: 4,
        title: "Retrieval-Augmented Generation",
        doi: "10.1000/example-doi",
        attachmentIDs: [104],
      }),
    );
    itemsById.set(104, makeAttachment({ id: 104, title: "RAG PDF" }));
    itemsById.set(
      5,
      makeRegularItem({
        id: 5,
        title: "Retrieval-Augmented Generation",
        doi: "10.1000/example-doi",
      }),
    );

    const results = await searchPaperCandidates(1, "10.1000/example-doi");

    assert.lengthOf(results, 1);
    assert.equal(results[0].itemId, 4);
  });

  it("reuses the library index until the cache is invalidated", async function () {
    itemsById.set(
      8,
      makeRegularItem({
        id: 8,
        title: "Cache Me If You Can",
        firstCreator: "Cache Author",
        attachmentIDs: [108],
      }),
    );
    itemsById.set(108, makeAttachment({ id: 108, title: "Cache PDF" }));

    await searchPaperCandidates(1, "cache author");
    await searchPaperCandidates(1, "cache");
    assert.equal(getAllCount, 1);

    invalidatePaperSearchCache(1);
    await searchPaperCandidates(1, "cache");
    assert.equal(getAllCount, 2);
  });
});
