function estimateDataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return dataUrl.length;
  const payloadLength = dataUrl.length - commaIndex - 1;
  return Math.max(0, Math.floor((payloadLength * 3) / 4));
}

export async function optimizeImageDataUrl(
  win: Window,
  dataUrl: string,
): Promise<string> {
  const maxDimension = 2048;
  const maxLosslessBytes = 2 * 1024 * 1024;
  const maxPassthroughBytes = 4 * 1024 * 1024;
  const jpegQuality = 0.88;

  try {
    const ImageCtor = win.Image as typeof Image;
    const img = new ImageCtor();
    img.src = dataUrl;
    await img.decode();

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return dataUrl;

    const sourceBytes = estimateDataUrlByteLength(dataUrl);
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const needsResize = targetWidth !== width || targetHeight !== height;

    if (!needsResize && sourceBytes <= maxLosslessBytes) {
      return dataUrl;
    }

    const canvas = win.document.createElement("canvas") as HTMLCanvasElement;
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!ctx) return dataUrl;

    ctx.imageSmoothingEnabled = true;
    (
      ctx as CanvasRenderingContext2D & {
        imageSmoothingQuality?: "low" | "medium" | "high";
      }
    ).imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const pngDataUrl = canvas.toDataURL("image/png");
    if (estimateDataUrlByteLength(pngDataUrl) <= maxLosslessBytes) {
      return pngDataUrl;
    }
    if (!needsResize && sourceBytes <= maxPassthroughBytes) {
      return dataUrl;
    }
    return canvas.toDataURL("image/jpeg", jpegQuality);
  } catch (err) {
    ztoolkit.log("Image optimize failed:", err);
    return dataUrl;
  }
}
