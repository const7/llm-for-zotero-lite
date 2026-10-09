import { config } from "../../../package.json";
import {
  persistAttachmentBlob,
  readAttachmentBytes,
} from "./attachmentStorage";

type PdfRenderer = {
  open: (bytes: Uint8Array) => Promise<number>;
  render: (pageNumber: number) => Promise<Uint8Array>;
  destroy: () => Promise<void>;
};

export async function renderAllPdfPages(
  contextItemId: number,
  opts?: { maxPages?: number },
): Promise<{ storedPath: string; contentHash: string; pageIndex: number }[]> {
  const attachment = Zotero.Items.get(contextItemId);
  if (
    !attachment?.isAttachment() ||
    attachment.attachmentContentType !== "application/pdf"
  ) {
    throw new Error("Not a PDF attachment");
  }
  const filePath = await attachment.getFilePathAsync();
  if (!filePath) throw new Error("Could not locate PDF file");
  const bytes = await readAttachmentBytes(filePath);
  const chrome = ztoolkit.getGlobal("ChromeUtils") as any;
  const legacy = Number.parseInt(Zotero.version, 10) < 8;
  const { HiddenBrowser } = legacy
    ? chrome.import("chrome://zotero/content/HiddenBrowser.jsm")
    : chrome.importESModule("chrome://zotero/content/HiddenBrowser.mjs");
  // Keep rendering isolated from reader tabs, navigation, and reading position.
  const browser = new HiddenBrowser();
  let renderer: PdfRenderer | undefined;
  try {
    if (
      (await browser.load(
        `chrome://${config.addonRef}/content/pdf-renderer.html${legacy ? "?legacy" : ""}`,
      )) === false
    ) {
      throw new Error("Could not load background PDF renderer");
    }
    const win = browser.contentWindow.wrappedJSObject;
    // HiddenBrowser.load resolves on navigation, before page scripts run.
    if (win.document.readyState === "loading") {
      await new Promise<void>((resolve) =>
        win.addEventListener("DOMContentLoaded", () => resolve(), {
          once: true,
        }),
      );
    }
    const activeRenderer: PdfRenderer = await win.pdfRendererReady;
    renderer = activeRenderer;
    const numPages = Math.min(
      opts?.maxPages ?? 200,
      await activeRenderer.open(
        (ztoolkit.getGlobal("Cu") as any).cloneInto(bytes, win),
      ),
    );
    const results: {
      storedPath: string;
      contentHash: string;
      pageIndex: number;
    }[] = [];
    for (let pageIndex = 0; pageIndex < numPages; pageIndex += 1) {
      const pageBytes = new Uint8Array(
        await activeRenderer.render(pageIndex + 1),
      );
      const persisted = await persistAttachmentBlob(
        `page-${pageIndex + 1}.png`,
        pageBytes,
      );
      results.push({
        storedPath: persisted.storedPath,
        contentHash: persisted.contentHash,
        pageIndex,
      });
    }
    return results;
  } finally {
    try {
      await renderer?.destroy();
    } finally {
      browser.destroy();
    }
  }
}
