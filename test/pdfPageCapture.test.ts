import { assert } from "chai";
import { renderAllPdfPages } from "../src/modules/contextPanel/pdfPageCapture";

describe("background PDF page capture", function () {
  const globals = globalThis as any;
  const original = {
    Zotero: globals.Zotero,
    ztoolkit: globals.ztoolkit,
    IOUtils: globals.IOUtils,
  };
  let pages: number[];
  let written: Uint8Array[];
  let rendererDestroyed: boolean;
  let browserDestroyed: boolean;
  let failOnPage: number;
  let failOnOpen: boolean;
  let loadedUrl: string;
  let importedModule: string;

  beforeEach(function () {
    pages = [];
    written = [];
    rendererDestroyed = false;
    browserDestroyed = false;
    failOnPage = 0;
    failOnOpen = false;
    const renderer = {
      async open(bytes: Uint8Array) {
        assert.deepEqual(Array.from(bytes), [37, 80, 68, 70]);
        if (failOnOpen) throw new Error("PDF load failed");
        return 3;
      },
      async render(pageNumber: number) {
        pages.push(pageNumber);
        if (pageNumber === failOnPage) throw new Error("Page render failed");
        return new Uint8Array([137, 80, 78, 71, pageNumber]);
      },
      async destroy() {
        rendererDestroyed = true;
      },
    };
    class HiddenBrowser {
      contentWindow = {
        wrappedJSObject: {
          document: { readyState: "complete" },
          pdfRendererReady: renderer,
        },
      };
      async load(url: string) {
        loadedUrl = url;
        return globals.Zotero.version.startsWith("7.") ? undefined : true;
      }
      destroy() {
        browserDestroyed = true;
      }
    }
    globals.Zotero = {
      version: "10.0.6",
      Items: {
        get: () => ({
          isAttachment: () => true,
          attachmentContentType: "application/pdf",
          getFilePathAsync: async () => "/paper.pdf",
        }),
      },
      DataDirectory: { dir: "/data" },
      DB: { queryAsync: async () => [] },
      get Reader() {
        throw new Error("Background capture must not access the reader");
      },
      get Tabs() {
        throw new Error("Background capture must not access tabs");
      },
    };
    globals.ztoolkit = {
      getGlobal(name: string) {
        if (name === "ChromeUtils") {
          const importModule = (url: string) => {
            importedModule = url;
            return { HiddenBrowser };
          };
          return { importESModule: importModule, import: importModule };
        }
        if (name === "Cu") return { cloneInto: (bytes: Uint8Array) => bytes };
        throw new Error(`Unexpected global: ${name}`);
      },
    };
    globals.IOUtils = {
      read: async () => new Uint8Array([37, 80, 68, 70]),
      makeDirectory: async () => {},
      write: async (_path: string, bytes: Uint8Array) => written.push(bytes),
    };
  });

  afterEach(function () {
    return Object.assign(globals, original);
  });

  it("persists pages in order without touching reader tabs", async function () {
    const result = await renderAllPdfPages(42);
    assert.deepEqual(pages, [1, 2, 3]);
    assert.deepEqual(
      result.map((page) => page.pageIndex),
      [0, 1, 2],
    );
    assert.deepEqual(
      written.map((bytes) => bytes[4]),
      [1, 2, 3],
    );
    assert.isTrue(rendererDestroyed);
    assert.isTrue(browserDestroyed);
  });

  it("honors the page limit", async function () {
    await renderAllPdfPages(42, { maxPages: 2 });
    assert.deepEqual(pages, [1, 2]);
  });

  it("uses the Zotero 7 module and accepts its void load result", async function () {
    globals.Zotero.version = "7.0.32";
    await renderAllPdfPages(42);
    assert.equal(importedModule, "chrome://zotero/content/HiddenBrowser.jsm");
    assert.include(loadedUrl, "?legacy");
    assert.deepEqual(pages, [1, 2, 3]);
  });

  for (const failure of ["open", "render"] as const) {
    it(`releases rendering resources after ${failure} failure`, async function () {
      failOnOpen = failure === "open";
      failOnPage = failure === "render" ? 2 : 0;
      try {
        await renderAllPdfPages(42);
        assert.fail("Expected PDF capture to fail");
      } catch (err) {
        assert.match(String(err), /PDF load failed|Page render failed/);
      }
      assert.isTrue(rendererDestroyed);
      assert.isTrue(browserDestroyed);
    });
  }
});
