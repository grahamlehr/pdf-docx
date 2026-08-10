import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { ParsedPdf, PdfLine, PdfPageData, PdfTextFragment } from "./types";

GlobalWorkerOptions.workerSrc = pdfWorker;

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/£\s+(?=\d)/g, "£")
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

async function cropLogo(pageProxy: any, baseViewport: any): Promise<Uint8Array | undefined> {
  try {
    const scale = 2;
    const viewport = pageProxy.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return undefined;

    await pageProxy.render({ canvasContext: context, viewport }).promise;

    const sourceX = Math.round(baseViewport.width * 0.69 * scale);
    const sourceY = Math.round(baseViewport.height * 0.005 * scale);
    const sourceWidth = Math.round(baseViewport.width * 0.285 * scale);
    const sourceHeight = Math.round(baseViewport.height * 0.105 * scale);

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

    return dataUrlToBytes(crop.toDataURL("image/png"));
  } catch {
    return undefined;
  }
}

export async function parsePdfFile(file: File): Promise<ParsedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: PdfPageData[] = [];
  let logoPng: Uint8Array | undefined;
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
      logoPng = await cropLogo(page, viewport);
    }
  }

  if (textCount < 10) {
    throw new Error(
      "This PDF does not appear to contain selectable text. The current MVP intentionally does not use OCR.",
    );
  }

  return { pages, logoPng };
}
