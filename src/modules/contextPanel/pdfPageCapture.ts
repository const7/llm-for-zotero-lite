import { persistAttachmentBlob } from "./attachmentStorage";
import {
  getActiveReaderForSelectedTab,
  getLastKnownSelectedTabId,
  selectZoteroTab,
} from "./contextResolution";

function unwrapWrappedJsObject<T>(value: T): T {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  try {
    return (value as T & { wrappedJSObject?: T }).wrappedJSObject || value;
  } catch {
    return value;
  }
}

type RenderablePdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
  }) => unknown;
};

function resolveRenderablePdfPage(value: unknown): RenderablePdfPage | null {
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const candidate = unwrapWrappedJsObject(current as Record<string, unknown>);
    if (
      typeof (candidate as Partial<RenderablePdfPage>).getViewport ===
        "function" &&
      typeof (candidate as Partial<RenderablePdfPage>).render === "function"
    ) {
      return candidate as RenderablePdfPage;
    }
    if (typeof candidate === "object") {
      const rec = candidate as Record<string, unknown>;
      queue.push(rec.pdfPage, rec._pdfPage, rec.page, rec.pageProxy);
    }
  }
  return null;
}

function getPdfViewerApplication(reader: any): any | null {
  const candidates = [
    reader?._internalReader?._lastView,
    reader?._internalReader?._primaryView,
    reader?._internalReader?._secondaryView,
    reader,
  ];
  for (const candidate of candidates) {
    const direct =
      candidate?._iframeWindow?.PDFViewerApplication ||
      candidate?._iframe?.contentWindow?.PDFViewerApplication ||
      candidate?._window?.PDFViewerApplication;
    if (direct?.pdfDocument) return direct;
    try {
      const wrapped =
        candidate?._iframeWindow?.wrappedJSObject?.PDFViewerApplication ||
        candidate?._iframe?.contentWindow?.wrappedJSObject
          ?.PDFViewerApplication ||
        candidate?._window?.wrappedJSObject?.PDFViewerApplication;
      if (wrapped?.pdfDocument) return wrapped;
    } catch {
      // cross-origin access may throw — ignore
    }
  }
  return null;
}

function getReaderDocument(reader: any): Document | null {
  return (
    reader?._iframeWindow?.document ||
    reader?._iframe?.contentDocument ||
    reader?._internalReader?._lastView?._iframeWindow?.document ||
    null
  );
}

function isCanvasElement(value: unknown): value is HTMLCanvasElement {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { getContext?: unknown }).getContext === "function" &&
    ((value as { nodeName?: unknown }).nodeName === "CANVAS" ||
      (value as { tagName?: unknown }).tagName === "CANVAS"),
  );
}

function pickLargestCanvas(
  canvases: HTMLCanvasElement[],
): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const canvas of canvases) {
    const area = (Number(canvas?.width) || 0) * (Number(canvas?.height) || 0);
    if (area > bestArea) {
      best = canvas;
      bestArea = area;
    }
  }
  return best;
}

function getPageViewCanvas(
  app: any,
  pageIndex: number,
): HTMLCanvasElement | null {
  const pageView = unwrapWrappedJsObject(
    app?.pdfViewer?.getPageView?.(pageIndex) ||
      app?.pdfViewer?._pages?.[pageIndex] ||
      null,
  ) as { canvas?: unknown; div?: Element | null } | null;
  if (!pageView) return null;
  const directCanvas = unwrapWrappedJsObject(pageView.canvas);
  if (isCanvasElement(directCanvas)) return directCanvas;
  if (pageView.div) {
    return pickLargestCanvas(
      Array.from(
        pageView.div.querySelectorAll("canvas"),
      ) as HTMLCanvasElement[],
    );
  }
  return null;
}

function findRenderedPageCanvas(
  doc: Document,
  pageNumber: number,
): HTMLCanvasElement | null {
  for (const selector of [
    `.page[data-page-number="${pageNumber}"] canvas`,
    `.page[data-page-number="${pageNumber}"] .canvasWrapper canvas`,
    `[data-page-number="${pageNumber}"] canvas`,
  ]) {
    const match = pickLargestCanvas(
      Array.from(doc.querySelectorAll(selector)) as HTMLCanvasElement[],
    );
    if (match) return match;
  }
  return null;
}

async function waitForRenderedPageCanvas(
  app: any,

  reader: any,
  pageNumber: number,
  timeoutMs = 1800,
): Promise<HTMLCanvasElement | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const fromView = getPageViewCanvas(app, pageNumber - 1);
    if (fromView && fromView.width > 0 && fromView.height > 0) return fromView;
    const doc = getReaderDocument(reader);
    if (doc) {
      const fromDom = findRenderedPageCanvas(doc, pageNumber);
      if (fromDom && fromDom.width > 0 && fromDom.height > 0) return fromDom;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return null;
}

/**
 * Navigates the reader to a specific page index (0-based).
 */

async function navigateReaderToPage(
  reader: any,
  pageIndex: number,
  pageLabel?: string,
): Promise<boolean> {
  if (typeof reader?.navigate !== "function") return false;
  const idx = Math.max(0, Math.floor(pageIndex));
  const normalizedPageLabel = `${pageLabel ?? ""}`.trim();
  try {
    await reader.navigate(
      normalizedPageLabel
        ? { pageIndex: idx, pageLabel: normalizedPageLabel }
        : { pageIndex: idx, pageLabel: `${idx + 1}` },
    );
    return true;
  } catch {
    try {
      await reader.navigate({ pageIndex: idx });
      return true;
    } catch {
      return false;
    }
  }
}

function getReaderItemId(reader: any): number {
  const raw = Number(reader?._item?.id || reader?.itemID || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

async function waitForReaderForItem(targetItemId: number): Promise<any | null> {
  const normalizedTargetItemId = Math.floor(targetItemId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2200) {
    const activeReader = getActiveReaderForSelectedTab();
    if (getReaderItemId(activeReader) === normalizedTargetItemId) {
      return activeReader;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return null;
}

async function openReaderForItem(
  targetItemId: number,
  location?: { pageIndex: number; pageLabel?: string },
): Promise<any | null> {
  const activeReader = getActiveReaderForSelectedTab();
  if (getReaderItemId(activeReader) === Math.floor(targetItemId)) {
    if (location) {
      await navigateReaderToPage(
        activeReader,
        location.pageIndex,
        location.pageLabel,
      );
    }
    return activeReader;
  }
  const readerApi = Zotero.Reader as
    | {
        open?: (
          itemID: number,
          location?: _ZoteroTypes.Reader.Location,
        ) => Promise<void | _ZoteroTypes.ReaderInstance>;
      }
    | undefined;
  if (typeof readerApi?.open === "function") {
    const opened = await readerApi.open(
      Math.floor(targetItemId),
      location
        ? {
            pageIndex: Math.floor(location.pageIndex),
            ...(location.pageLabel
              ? { pageLabel: `${location.pageLabel}`.trim() }
              : {}),
          }
        : undefined,
    );
    if (opened) return opened;
  }
  const waited = await waitForReaderForItem(targetItemId);
  if (waited && location) {
    await navigateReaderToPage(waited, location.pageIndex, location.pageLabel);
  }
  return waited;
}

function restoreNonReaderTab(savedTabId: string | number | null): void {
  const targetTabId = savedTabId || "zotero-pane";
  const doRestore = () => {
    void selectZoteroTab(targetTabId);
  };
  doRestore();
  setTimeout(doRestore, 500);
  setTimeout(doRestore, 1500);
  setTimeout(doRestore, 3000);
}

async function waitForPdfDocument(
  reader: any,
  timeoutMs = 2200,
): Promise<any | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const app = getPdfViewerApplication(reader);
    if (app?.pdfDocument) return app;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return null;
}

async function captureRenderedReaderPage(
  app: any,
  reader: any,
  pageIndex: number,
): Promise<Uint8Array | null> {
  const sourceCanvas = await waitForRenderedPageCanvas(
    app,
    reader,
    pageIndex + 1,
  );
  if (!sourceCanvas) return null;
  try {
    return await canvasToBytes(sourceCanvas);
  } catch {
    const doc = sourceCanvas.ownerDocument || getReaderDocument(reader);
    if (!doc) return null;
    const tempCanvas = doc.createElement("canvas") as HTMLCanvasElement;
    tempCanvas.width = Math.max(1, sourceCanvas.width);
    tempCanvas.height = Math.max(1, sourceCanvas.height);
    const context = tempCanvas.getContext(
      "2d",
    ) as CanvasRenderingContext2D | null;
    if (!context) return null;
    context.drawImage(sourceCanvas, 0, 0);
    return canvasToBytes(tempCanvas);
  }
}

async function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/png");
    });
    if (blob) {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function renderAllPdfPages(
  contextItemId: number,
  opts?: { maxPages?: number },
): Promise<{ storedPath: string; contentHash: string; pageIndex: number }[]> {
  const maxPages = opts?.maxPages ?? 200;
  const savedTabId = getLastKnownSelectedTabId();
  try {
    const reader = await openReaderForItem(contextItemId, {
      pageIndex: 0,
      pageLabel: "1",
    });
    if (!reader) throw new Error("Could not open PDF reader");
    const app = await waitForPdfDocument(reader);
    if (!app?.pdfDocument) {
      throw new Error("Could not load PDF document");
    }
    const pdfDocument = unwrapWrappedJsObject(
      app.pdfDocument as {
        numPages?: number;
        getPage?: (n: number) => Promise<unknown>;
      },
    );
    const rawCount = Number(
      pdfDocument?.numPages ??
        (app as { pdfDocument?: { numPages?: number } })?.pdfDocument
          ?.numPages ??
        0,
    );
    const numPages = Math.min(
      maxPages,
      Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0,
    );
    if (numPages <= 0) throw new Error("PDF has no pages");

    const results: {
      storedPath: string;
      contentHash: string;
      pageIndex: number;
    }[] = [];
    for (let i = 0; i < numPages; i += 1) {
      await navigateReaderToPage(reader, i, `${i + 1}`);
      let bytes = await captureRenderedReaderPage(app, reader, i);
      if (!bytes) {
        const canvasDoc =
          getReaderDocument(reader) || Zotero.getMainWindow?.()?.document;
        if (canvasDoc && typeof pdfDocument?.getPage === "function") {
          const pdfPage = resolveRenderablePdfPage(
            await pdfDocument.getPage(i + 1),
          );
          if (pdfPage) {
            const viewport = pdfPage.getViewport({ scale: 1.8 });
            const canvas = canvasDoc.createElement(
              "canvas",
            ) as HTMLCanvasElement;
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            const context = canvas.getContext(
              "2d",
            ) as CanvasRenderingContext2D | null;
            if (context) {
              const renderTask = pdfPage.render({
                canvasContext: context,
                viewport,
              });
              if (
                renderTask &&
                typeof renderTask === "object" &&
                "promise" in renderTask &&
                renderTask.promise
              ) {
                await renderTask.promise;
              } else if (
                renderTask &&
                (typeof renderTask === "object" ||
                  typeof renderTask === "function") &&
                "then" in renderTask &&
                typeof renderTask.then === "function"
              ) {
                await renderTask;
              }
              bytes = await canvasToBytes(canvas);
            }
          }
        }
      }
      if (!bytes) continue;
      const persisted = await persistAttachmentBlob(`page-${i + 1}.png`, bytes);
      results.push({
        storedPath: persisted.storedPath,
        contentHash: persisted.contentHash,
        pageIndex: i,
      });
    }
    return results;
  } finally {
    restoreNonReaderTab(savedTabId);
  }
}
