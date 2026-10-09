/* global window, document */
const legacy = new window.URLSearchParams(window.location.search).has("legacy");
const pdfjsReady = legacy
  ? new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "resource://pdf.js/build/pdf.js";
      script.onload = () => resolve(window.pdfjsLib);
      script.onerror = () => reject(new Error("Could not load PDF.js"));
      document.head.appendChild(script);
    })
  : import("resource://zotero/reader/pdf/build/pdf.mjs");
window.pdfRendererReady = pdfjsReady.then((pdfjs) => {
  const assets = legacy
    ? "resource://pdf.js/"
    : "resource://zotero/reader/pdf/";
  pdfjs.GlobalWorkerOptions.workerSrc = `${assets}build/pdf.worker.${legacy ? "js" : "mjs"}`;
  let loadingTask;
  let pdf;
  return {
    async open(bytes) {
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        cMapUrl: `${assets}web/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}web/standard_fonts/`,
        wasmUrl: `${assets}web/wasm/`,
        isEvalSupported: false,
      });
      pdf = await loadingTask.promise;
      return pdf.numPages;
    },
    async render(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          // Print intent avoids requestAnimationFrame in a hidden window.
          intent: "print",
        }).promise;
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!blob) throw new Error(`Could not encode PDF page ${pageNumber}`);
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    },
    async destroy() {
      await loadingTask?.destroy();
    },
  };
});
