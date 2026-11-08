import { createWorker } from 'tesseract.js';
import { makeCanvas } from './image.js';
import { fixToken, isUncertain, joinLines } from './text.js';

const BASE = import.meta.env.BASE_URL;
let workerPromise = null;
let onProgress = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('ita', 1, {
      workerPath: `${BASE}tesseract/worker.min.js`,
      corePath: `${BASE}tesseract/core`,
      langPath: `${BASE}tesseract/lang`,
      gzip: true,
      logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress); },
    });
  }
  return workerPromise;
}

export function warmUp() { getWorker().catch(() => { workerPromise = null; }); }

const px = (r, W, H) => ({
  left: Math.max(0, Math.round(r.x * W)),
  top: Math.max(0, Math.round(r.y * H)),
  width: Math.max(1, Math.round(r.w * W)),
  height: Math.max(1, Math.round(r.h * H)),
});

function cleanWord(w) {
  const raw = (w.text || '').trim();
  if (!raw) return null;
  const { t, changed } = fixToken(raw);
  return { t, u: isUncertain(t, w.confidence, changed), x0: w.bbox.x0, x1: w.bbox.x1 };
}

// Spezza un paragrafo di Tesseract dove una riga finisce molto prima del margine destro:
// nelle relazioni "Paziente: …", "ECG: …" sono righe a sé e vanno tenute separate.
// Il margine destro si stima su tutta la pagina, così anche due righe corte consecutive
// ("Paziente: …" e "Visita del …") restano paragrafi distinti.
function splitParagraph(par, left, right) {
  const lines = par.lines.filter((l) => l.words.some((w) => w.text.trim()));
  if (!lines.length) return [];
  const width = right - left;
  const groups = [];
  let cur = [];
  for (const l of lines) {
    cur.push(l);
    if (l.bbox.x1 < right - width * 0.18) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// OCR di una pagina già raddrizzata. Le zone coperte e le tabelle vengono imbiancate
// per la lettura principale; ogni tabella viene poi letta a parte, colonna per colonna.
export async function readPage(canvas, page, progress) {
  const worker = await getWorker();
  const W = canvas.width, H = canvas.height;

  const work = makeCanvas(W, H);
  const ctx = work.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = '#fff';
  for (const r of [...page.covers, ...page.tables]) {
    const p = px(r, W, H);
    ctx.fillRect(p.left, p.top, p.width, p.height);
  }

  const nT = page.tables.length;
  const share = 1 / (1 + nT);
  onProgress = (p) => progress && progress(p * share);
  await worker.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: '300', preserve_interword_spaces: '0' });
  const { data } = await worker.recognize(work, {}, { blocks: true, text: false });

  const items = [];
  const all = [];
  for (const block of data.blocks || []) for (const par of block.paragraphs || []) for (const l of par.lines || []) all.push(l);
  const q = (arr, f) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * f))]; };
  const pageRight = all.length ? q(all.map((l) => l.bbox.x1), 0.9) : W;
  const pageLeft = all.length ? q(all.map((l) => l.bbox.x0), 0.1) : 0;
  for (const block of data.blocks || []) {
    for (const par of block.paragraphs || []) {
      for (const group of splitParagraph(par, pageLeft, pageRight)) {
        const lines = group.map((l) => l.words.map(cleanWord).filter(Boolean));
        const tokens = joinLines(lines);
        if (!tokens.length) continue;
        const x0 = Math.min(...group.map((l) => l.bbox.x0)), x1 = Math.max(...group.map((l) => l.bbox.x1));
        const y0 = Math.min(...group.map((l) => l.bbox.y0)), y1 = Math.max(...group.map((l) => l.bbox.y1));
        items.push({ type: 'p', tokens, box: { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H } });
      }
    }
  }

  for (let ti = 0; ti < nT; ti++) {
    const tb = page.tables[ti];
    const p = px(tb, W, H);
    const crop = makeCanvas(p.width, p.height);
    const cctx = crop.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, p.width, p.height);
    cctx.drawImage(canvas, p.left, p.top, p.width, p.height, 0, 0, p.width, p.height);
    for (const r of page.covers) {
      const c = px(r, W, H);
      cctx.fillRect(c.left - p.left, c.top - p.top, c.width, c.height);
    }
    onProgress = (q) => progress && progress(share * (1 + ti + q));
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { data: td } = await worker.recognize(crop, {}, { blocks: true, text: false });
    items.push({ type: 'table', rows: tableRows(td, tb.cols, p.width), box: { x: tb.x, y: tb.y, w: tb.w, h: tb.h } });
  }

  onProgress = null;
  // ordine di lettura: dall'alto in basso (le tabelle vanno al loro posto)
  items.sort((a, b) => a.box.y - b.box.y);
  return items;
}

// Assegna ogni parola alla colonna in cui cade il suo centro; ogni riga di testo è una riga
// di tabella, ma una riga senza nulla nella prima colonna continua la riga precedente.
function tableRows(td, cols, width) {
  const nCols = cols.length + 1;
  const rows = [];
  const lines = [];
  for (const b of td.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push(l);
  lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  for (const l of lines) {
    const cells = Array.from({ length: nCols }, () => []);
    let any = false;
    for (const w of l.words) {
      const c = cleanWord(w);
      if (!c) continue;
      const xc = (c.x0 + c.x1) / 2 / width;
      let k = 0;
      while (k < cols.length && xc > cols[k]) k++;
      cells[k].push({ t: c.t, u: c.u });
      any = true;
    }
    if (!any) continue;
    if (rows.length && !cells[0].length) {
      const prev = rows[rows.length - 1];
      cells.forEach((c, k) => prev[k].push(...c));
    } else rows.push(cells);
  }
  return rows;
}
