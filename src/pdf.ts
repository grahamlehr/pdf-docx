import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { ParsedPdf, PdfLine, PdfLogo, PdfPageData, PdfTextFragment } from "./types";

GlobalWorkerOptions.workerSrc = pdfWorker;

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clusterIntoLines(fragments: PdfTextFragment[], page: number): PdfLine[] {
  const sorted = [...fragments].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: PdfTextFragment[][] = [];
  const tolerance = 2.8;

  for (const fragment of sorted) {
    const last = groups.at(-1);
    if (!last) {
      groups.push([fragment]);
      continue;
    }

    const avgY = last.reduce((sum, item) => sum + item.y, 0) / last.length;
    if (Math.abs(avgY - fragment.y) <= tolerance) {
      last.push(fragment);
    } else {
      groups.push([fragment]);
    }
  }

  return groups
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.x - b.x);
      const raw = ordered
        .map((fragment) => cleanText(fragment.text))
        .filter(Boolean)
        .join(" ");

      return {
        page,
        y: ordered.reduce((sum, item) => sum + item.y, 0) / ordered.length,
        x: Math.min(...ordered.map((item) => item.x)),
        text: cleanText(raw),
        fragments: ordered,
      } satisfies PdfLine;
    })
    .filter((line) => line.text.length > 0);
}

async function renderPageToDataUrl(pageProxy: any, viewport: any): Promise<string> {
  const targetWidth = 980;
  const scale = Math.max(1, targetWidth / viewport.width);
  const renderViewport = pageProxy.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not create PDF preview canvas.");

  await pageProxy.render({ canvasContext: context, viewport: renderViewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.88);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface PixelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function findInkBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PixelBounds | undefined {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha < 24) continue;

      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const distanceFromWhite = Math.max(255 - red, 255 - green, 255 - blue);
      if (distanceFromWhite < 28) continue;

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) return undefined;
  return { left, top, right, bottom };
}

async function cropLogo(pageProxy: any, baseViewport: any): Promise<PdfLogo | undefined> {
  try {
    // Render generously around the top-right header, then trim to the actual ink.
    // The old fixed crop both clipped template variants and included inconsistent
    // whitespace, which was then stretched into a fixed DOCX rectangle.
    const scale = 3;
    const viewport = pageProxy.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return undefined;

    await pageProxy.render({ canvasContext: context, viewport }).promise;

    const searchX = Math.round(baseViewport.width * 0.56 * scale);
    const searchY = 0;
    const searchWidth = Math.min(
      canvas.width - searchX,
      Math.round(baseViewport.width * 0.43 * scale),
    );
    const searchHeight = Math.min(
      canvas.height,
      Math.round(baseViewport.height * 0.16 * scale),
    );

    const searchPixels = context.getImageData(searchX, searchY, searchWidth, searchHeight);
    const bounds = findInkBounds(searchPixels.data, searchWidth, searchHeight);
    if (!bounds) return undefined;

    const padding = Math.round(5 * scale);
    const sourceX = searchX + Math.max(0, bounds.left - padding);
    const sourceY = searchY + Math.max(0, bounds.top - padding);
    const sourceRight = searchX + Math.min(searchWidth, bounds.right + padding + 1);
    const sourceBottom = searchY + Math.min(searchHeight, bounds.bottom + padding + 1);
    const sourceWidth = sourceRight - sourceX;
    const sourceHeight = sourceBottom - sourceY;

    if (sourceWidth < 2 || sourceHeight < 2) return undefined;

    const crop = document.createElement("canvas");
    crop.width = sourceWidth;
    crop.height = sourceHeight;
    const cropContext = crop.getContext("2d", { alpha: true });
    if (!cropContext) return undefined;

    cropContext.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    );

    return {
      data: dataUrlToBytes(crop.toDataURL("image/png")),
      width: sourceWidth,
      height: sourceHeight,
    };
  } catch {
    return undefined;
  }
}

export async function parsePdfFile(file: File): Promise<ParsedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: PdfPageData[] = [];
  let logo: PdfLogo | undefined;
  let textCount = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const styles = textContent.styles as Record<string, { fontFamily?: string }>;

    const fragments: PdfTextFragment[] = [];
    for (const rawItem of textContent.items as any[]) {
      if (!("str" in rawItem) || !rawItem.str?.trim()) continue;
      const transform = rawItem.transform as number[];
      const fontSize = Math.max(1, Math.hypot(transform[2] ?? 0, transform[3] ?? 0));
      const fontFamily = styles[rawItem.fontName]?.fontFamily ?? "Arial";

      fragments.push({
        text: rawItem.str,
        x: transform[4] ?? 0,
        y: viewport.height - (transform[5] ?? 0),
        width: rawItem.width ?? 0,
        height: rawItem.height ?? fontSize,
        fontSize,
        fontFamily,
      });
    }

    textCount += fragments.length;
    const lines = clusterIntoLines(fragments, pageNumber);
    const previewUrl = await renderPageToDataUrl(page, viewport);
    pages.push({
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      lines,
      previewUrl,
    });

    if (pageNumber === 1) {
      logo = await cropLogo(page, viewport);
    }
  }

  if (textCount < 10) {
    throw new Error(
      "This PDF does not appear to contain selectable text. The current MVP intentionally does not use OCR.",
    );
  }

  return { pages, logo };
}
