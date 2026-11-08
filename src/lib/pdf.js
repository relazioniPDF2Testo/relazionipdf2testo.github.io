import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { makeCanvas, scaledCopy, grayOf, binarize, estimateSkew, straighten, detectFigures, canvasToBlob } from './image.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

// Rende la pagina a circa 300 dpi (larghezza ~2480 px per un A4).
async function renderFull(pdf, n) {
  const page = await pdf.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.max(1.5, Math.min(4.5, 2480 / vp1.width));
  const vp = page.getViewport({ scale });
  const canvas = makeCanvas(vp.width, vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

// Prima analisi di una pagina: inclinazione, zone grafiche proposte, anteprima.
export async function preparePage(pdf, n) {
  const full = await renderFull(pdf, n);
  const small = scaledCopy(full, 1000);
  const skew = estimateSkew(binarize(grayOf(small)));
  const straight = straighten(full, skew);
  const small2 = scaledCopy(straight, 1000);
  const covers = detectFigures(binarize(grayOf(small2)));
  const preview = await canvasToBlob(scaledCopy(straight, 1200));
  return { skew, covers, tables: [], preview, ratio: straight.height / straight.width };
}

// Pagina raddrizzata a piena risoluzione, pronta per l'OCR.
export async function pageForOcr(pdf, n, skew) {
  return straighten(await renderFull(pdf, n), skew);
}
