import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/source-serif-4';
import './style.css';
import { openPdf, preparePage, pageForOcr } from './lib/pdf.js';
import { canvasToBlob } from './lib/image.js';
import { readPage, warmUp } from './lib/ocr.js';
import { tokensToHtml } from './lib/text.js';
import { detectColumns } from './lib/image.js';
import { blocksFromEditor, blocksToHtml, blocksToText, blocksToDocx } from './lib/export.js';
import { saveDoc, getDoc, deleteDoc, allDocs, daysLeft, cleanup, askPersistence } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const S = { step: 1, doc: null, pdf: null, urls: [], imgs: [], cur: 0, mode: 'copri', sel: -1, hist: {}, busy: false, z2: 1, z3: 1, hi: {} };

// ---------- navigazione a linguette ----------
const STEPS = ['Carica', 'Controlla le pagine', 'Testo pronto'];
function canGo(n) {
  if (S.busy) return n === S.step;
  if (n === 1) return true;
  if (n === 2) return !!S.doc;
  return !!(S.doc && S.doc.result);
}
function renderTabs() {
  $('tabs').innerHTML = STEPS.map((t, i) => {
    const n = i + 1, cur = n === S.step, done = n < S.step && canGo(n + 1);
    return `<button class="tab" type="button" data-n="${n}" ${cur ? 'aria-current="step"' : ''} ${canGo(n) ? '' : 'aria-disabled="true"'}>
      ${done ? '<span class="chk" aria-hidden="true">✓</span>' : ''}<span class="n">${n}</span>${t}</button>`;
  }).join('');
  $('tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    const n = +b.dataset.n;
    if (canGo(n) && n !== S.step) go(n);
  }));
}
function go(n) {
  S.step = n;
  [1, 2, 3].forEach((i) => $('s' + i).classList.toggle('on', i === n));
  renderTabs();
  if (n === 1) renderRecent();
  if (n === 2) enterReview();
  if (n === 3) enterResult();
  window.scrollTo(0, 0);
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => S.doc && saveDoc(S.doc).catch(() => {}), 800);
}

// ---------- passo 1: carica ----------
const fmtDay = (ts) => new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

async function renderRecent() {
  let docs = [];
  try { docs = await allDocs(); } catch { /* archivio non disponibile */ }
  docs.sort((a, b) => b.lastOpened - a.lastOpened);
  const box = $('recent');
  if (!docs.length) { box.innerHTML = '<p class="empty">Qui compariranno i documenti che hai già letto.</p>'; return; }
  box.innerHTML = docs.map((d) => {
    const n = daysLeft(d);
    return `<div class="row"><svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26"><path d="M6 2h9l5 5v15H6z" fill="none" stroke="#D02008" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12h8M9 16h8" stroke="#D02008" stroke-width="1.8"/></svg>
      <div class="meta"><div class="name"></div><div class="when">Aperto il ${fmtDay(d.lastOpened)}. Si cancella ${n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`}.</div></div>
      <button class="btn" type="button" data-open="${d.id}">Riapri</button>
      <button class="btn quiet" type="button" data-del="${d.id}">Elimina</button></div>`;
  }).join('');
  box.querySelectorAll('.row .name').forEach((el, i) => { el.textContent = docs[i].name; });
  box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => reopen(b.dataset.open)));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const d = docs.find((x) => x.id === b.dataset.del);
    if (!confirm(`Eliminare "${d.name}" da questo computer?`)) return;
    await deleteDoc(d.id);
    if (S.doc && S.doc.id === d.id) closeDoc();
    renderRecent();
    renderTabs();
  }));
}

function closeDoc() {
  S.urls.forEach((u) => URL.revokeObjectURL(u));
  Object.values(S.hi).forEach((p) => p.then((u) => u && URL.revokeObjectURL(u)));
  Object.assign(S, { doc: null, pdf: null, urls: [], imgs: [], cur: 0, sel: -1, hist: {}, hi: {}, z2: 1, z3: 1 });
}

function setBusy1(on, frac = 0, txt = '') {
  $('busy1').hidden = !on;
  $('bar1').style.width = `${Math.round(frac * 100)}%`;
  $('busy1txt').textContent = txt;
  $('drop').style.pointerEvents = on ? 'none' : '';
  S.busy = on;
  renderTabs();
}

async function handleFile(file) {
  $('err1').textContent = '';
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    $('err1').textContent = 'Questo file non è un PDF. Scegli un file che finisce con .pdf.';
    return;
  }
  setBusy1(true, 0, 'Apertura del documento…');
  try {
    const pdf = await openPdf(file);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setBusy1(true, (i - 1) / pdf.numPages, `Preparo la pagina ${i} di ${pdf.numPages}…`);
      const pg = await preparePage(pdf, i);
      pg.found = pg.covers;
      if (!$('autoCover').checked) pg.covers = [];
      pages.push(pg);
    }
    closeDoc();
    const now = Date.now();
    S.doc = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, name: file.name.replace(/\.pdf$/i, ''), created: now, lastOpened: now, pdf: file, pages, result: null, html: null, stale: false };
    S.pdf = pdf;
    loadPreviews();
    await saveDoc(S.doc);
    askPersistence();
    warmUp();
    setBusy1(false);
    go(2);
  } catch (e) {
    console.error(e);
    setBusy1(false);
    $('err1').textContent = 'Questo PDF non si apre. Prova con un altro file, oppure riesporta il PDF dallo scanner.';
  } finally {
    $('file').value = '';
  }
}

function loadPreviews() {
  S.urls = S.doc.pages.map((p) => URL.createObjectURL(p.preview));
  S.imgs = S.urls.map((u) => { const im = new Image(); im.src = u; return im; });
}

async function reopen(id) {
  $('err1').textContent = '';
  try {
    const doc = await getDoc(id);
    if (!doc) return renderRecent();
    closeDoc();
    doc.lastOpened = Date.now();
    S.doc = doc;
    loadPreviews();
    saveDoc(doc).catch(() => {});
    S.pdf = await openPdf(doc.pdf);
    warmUp();
    go(doc.result && !doc.stale ? 3 : 2);
  } catch (e) {
    console.error(e);
    $('err1').textContent = 'Questo documento non si riapre. Puoi eliminarlo e caricare di nuovo il PDF.';
  }
}

// opzione "esclusione automatica": ricordata su questo computer, spenta di default
try { $('autoCover').checked = localStorage.getItem('autoCover') === '1'; } catch { /* nessuna memoria */ }
$('autoCover').addEventListener('change', (e) => { try { localStorage.setItem('autoCover', e.target.checked ? '1' : '0'); } catch { /* facoltativo */ } });

const drop = $('drop');
$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- passo 2: controlla le pagine ----------
const page = () => S.doc.pages[S.cur];
const layer = $('layer');

function enterReview() {
  if (S.cur >= S.doc.pages.length) S.cur = 0;
  renderThumbs();
  showPage(S.cur);
  updateReadButton();
}

function renderThumbs() {
  $('thumbs').innerHTML = S.urls.map((u, i) => `<div class="th${S.doc.pages[i].skip ? ' off' : ''}" data-i="${i}" ${i === S.cur ? 'aria-current="true"' : ''}>
    <button class="open" type="button" aria-label="Mostra la pagina ${i + 1}"><span class="im"><img src="${u}" alt=""><span class="scan"></span></span></button>
    <label class="pick"><input type="checkbox" ${S.doc.pages[i].skip ? '' : 'checked'}> Pagina ${i + 1}</label></div>`).join('');
  $('thumbs').querySelectorAll('.th').forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector('.open').addEventListener('click', () => { if (!S.busy) showPage(i); });
    el.querySelector('input').addEventListener('change', (e) => setSkip([i], !e.target.checked));
  });
}

function setSkip(list, skip) {
  if (S.busy) return;
  let any = false;
  for (const i of list) if (!!S.doc.pages[i].skip !== skip) { S.doc.pages[i].skip = skip; any = true; }
  if (!any) return;
  if (S.doc.result) S.doc.stale = true;
  $('thumbs').querySelectorAll('.th').forEach((el, i) => {
    el.classList.toggle('off', !!S.doc.pages[i].skip);
    el.querySelector('input').checked = !S.doc.pages[i].skip;
  });
  showPageNote();
  updateReadButton();
  saveSoon();
}
$('selAll').addEventListener('click', () => setSkip(S.doc.pages.map((_, i) => i), false));
$('selNone').addEventListener('click', () => setSkip(S.doc.pages.map((_, i) => i), true));

function showPageNote() {
  const p = page(), el = $('straight');
  el.classList.toggle('warn', !!p.skip);
  if (p.skip) el.textContent = 'Questa pagina è esclusa e non verrà letta. Spunta la casella a sinistra per includerla.';
  else el.textContent = p.skew ? `Pagina raddrizzata in automatico: era storta di ${Math.abs(p.skew).toFixed(1).replace('.', ',')}°.` : '';
}

function showPage(i) {
  S.cur = i;
  S.sel = -1;
  $('thumbs').querySelectorAll('.th').forEach((b, k) => b.toggleAttribute('aria-current', k === i));
  $('thumbs').children[i]?.scrollIntoView({ block: 'nearest' });
  $('pageImg').src = S.urls[i];
  if (S.z2 > 1) useHi(i);
  showPageNote();
  $('pageNo').textContent = `Pagina ${i + 1} di ${S.doc.pages.length}`;
  fitStage();
  $('stageWrap').scrollTo(0, 0);
  drawZones();
}

function fitStage() {
  if (S.step !== 2 || !S.doc) return;
  const wrap = $('stageWrap');
  const top = wrap.getBoundingClientRect().top;
  const availH = Math.max(320, window.innerHeight - top - 64);
  wrap.style.height = `${availH}px`;
  const ratio = page().ratio;
  const w0 = Math.min(wrap.clientWidth - 30, (availH - 30) / ratio);
  const w = w0 * S.z2;
  $('stack').style.width = `${w}px`;
  $('stack').style.height = `${w * ratio}px`;
  wrap.classList.toggle('zoomed', S.z2 > 1);
}
window.addEventListener('resize', fitStage);

// ---------- ingrandimento ----------
const LEVELS = [1, 1.5, 2, 3, 4];

// Oltre il 100% l'anteprima non basta: si rende la pagina a piena risoluzione (una volta sola).
function hiRes(i) {
  if (!S.hi[i]) {
    const pdf = S.pdf, sk = S.doc.pages[i].skew;
    S.hi[i] = pageForOcr(pdf, i + 1, sk).then((c) => canvasToBlob(c, 'image/jpeg', 0.9)).then((b) => URL.createObjectURL(b)).catch(() => null);
  }
  return S.hi[i];
}
function useHi(i) {
  hiRes(i).then((u) => { if (u && S.step === 2 && S.cur === i && S.z2 > 1) $('pageImg').src = u; });
}

function zoomBar(box, get, set) {
  box.innerHTML = `<button class="btn sq" type="button" data-d="-1" aria-label="Rimpicciolisci" title="Rimpicciolisci">−</button>
    <span class="lvl" aria-live="polite"></span>
    <button class="btn sq" type="button" data-d="1" aria-label="Ingrandisci" title="Ingrandisci">+</button>
    <button class="btn" type="button" data-d="0">Adatta</button>`;
  const lvl = box.querySelector('.lvl');
  const show = () => { lvl.textContent = `${Math.round(get() * 100)}%`; };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = +b.dataset.d, k = LEVELS.indexOf(get());
    const z = d === 0 ? 1 : LEVELS[Math.max(0, Math.min(LEVELS.length - 1, k + d))];
    if (z !== get()) { set(z); show(); }
  });
  show();
  return { show, step: (d) => box.querySelector(`[data-d="${d}"]`).click() };
}

// mantiene al centro lo stesso punto della pagina quando cambia l'ingrandimento
function keepCenter(pane, fn) {
  const cx = (pane.scrollLeft + pane.clientWidth / 2) / Math.max(1, pane.scrollWidth);
  const cy = (pane.scrollTop + pane.clientHeight / 2) / Math.max(1, pane.scrollHeight);
  fn();
  pane.scrollLeft = cx * pane.scrollWidth - pane.clientWidth / 2;
  pane.scrollTop = cy * pane.scrollHeight - pane.clientHeight / 2;
}

const zoom2 = zoomBar($('zoom2'), () => S.z2, (z) => {
  keepCenter($('stageWrap'), () => { S.z2 = z; fitStage(); });
  if (z > 1) useHi(S.cur); else $('pageImg').src = S.urls[S.cur];
});

// Ctrl + rotellina per ingrandire, come nei lettori PDF
function wheelZoom(el, bar) {
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    bar.step(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}
wheelZoom($('stageWrap'), zoom2);

const pct = (v) => `${(v * 100).toFixed(3)}%`;

function drawZones() {
  const p = page();
  const W = layer.clientWidth, H = layer.clientHeight;
  layer.innerHTML = '';
  p.covers.forEach((c, k) => {
    const d = zoneEl(`zone cover${c.auto ? ' auto' : ''}`, c);
    if (c.w * W > 120 && c.h * H > 34) d.insertAdjacentHTML('beforeend', '<span>Non verrà letto</span>');
    addX(d, 'Togli questa copertura', () => { snapshot(); p.covers.splice(k, 1); changed(); });
  });
  p.tables.forEach((t, k) => {
    const d = zoneEl(`zone table${k === S.sel ? ' sel' : ''}`, t);
    d.dataset.t = k;
    d.insertAdjacentHTML('beforeend', `<span class="tag">Tabella con ${t.cols.length + 1} colonne</span>`);
    addX(d, 'Togli questa tabella', () => { snapshot(); p.tables.splice(k, 1); S.sel = -1; changed(); });
    t.cols.forEach((c, ci) => {
      const h = document.createElement('div');
      h.className = 'col';
      h.style.left = pct(c);
      h.title = 'Trascina per spostare la linea della colonna';
      h.addEventListener('pointerdown', (e) => startColDrag(e, k, ci, d));
      d.appendChild(h);
    });
  });
  const a = p.covers.filter((c) => c.auto).length, n = p.covers.length, t = p.tables.length;
  let info = n ? `${n} ${n === 1 ? 'parte coperta' : 'parti coperte'}` : 'Nessuna parte coperta';
  if (a) info += `, di cui ${a} in automatico (bordo giallo): controlla che vadano bene`;
  info += '.';
  if (t) info += ` ${t === 1 ? 'Una tabella segnata' : `${t} tabelle segnate`}.`;
  $('info').textContent = info;
  $('hint').textContent = S.mode === 'copri'
    ? 'Tieni premuto il mouse e trascina sopra le parti da non leggere.'
    : 'Disegna un rettangolo attorno alla tabella. Poi sposta le linee blu tra una colonna e l\'altra.';
  $('addCol').hidden = !(S.mode === 'tabella' && p.tables.length);
  $('undo').disabled = !(S.hist[S.cur] && S.hist[S.cur].length);
}

function zoneEl(cls, r) {
  const d = document.createElement('div');
  d.className = cls;
  Object.assign(d.style, { left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });
  layer.appendChild(d);
  return d;
}
function addX(d, label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'x';
  b.textContent = '×';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  d.appendChild(b);
}

function snapshot() {
  const p = page();
  (S.hist[S.cur] ||= []).push(JSON.stringify({ covers: p.covers, tables: p.tables }));
}
function changed() {
  if (S.doc.result) S.doc.stale = true;
  drawZones();
  updateReadButton();
  saveSoon();
}

function posIn(e) {
  const r = layer.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
}

let draw = null;
layer.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || S.busy) return;
  const tz = e.target.closest('.zone.table');
  if (tz && S.mode === 'tabella') { S.sel = +tz.dataset.t; drawZones(); return; }
  e.preventDefault();
  layer.setPointerCapture(e.pointerId);
  const s = posIn(e);
  const ghost = document.createElement('div');
  ghost.className = S.mode === 'copri' ? 'zone cover' : 'zone table';
  layer.appendChild(ghost);
  draw = { s, ghost, r: null };
});
layer.addEventListener('pointermove', (e) => {
  if (!draw) return;
  const p = posIn(e), s = draw.s;
  draw.r = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
  Object.assign(draw.ghost.style, { left: pct(draw.r.x), top: pct(draw.r.y), width: pct(draw.r.w), height: pct(draw.r.h) });
});
layer.addEventListener('pointerup', () => {
  if (!draw) return;
  const r = draw.r;
  draw.ghost.remove();
  draw = null;
  if (!r || r.w * layer.clientWidth < 12 || r.h * layer.clientHeight < 10) return;
  snapshot();
  if (S.mode === 'copri') page().covers.push({ ...r, auto: false });
  else {
    const img = S.imgs[S.cur];
    let cols = [0.5];
    try { if (img.complete) cols = detectColumns(img, r); } catch { /* proposta standard */ }
    page().tables.push({ ...r, cols });
    S.sel = page().tables.length - 1;
  }
  changed();
});

function startColDrag(e, ti, ci, zone) {
  e.stopPropagation();
  e.preventDefault();
  snapshot();
  const t = page().tables[ti];
  const h = e.currentTarget;
  h.setPointerCapture(e.pointerId);
  S.sel = ti;
  const move = (ev) => {
    const r = zone.getBoundingClientRect();
    const lo = ci > 0 ? t.cols[ci - 1] + 0.03 : 0.03;
    const hi = ci < t.cols.length - 1 ? t.cols[ci + 1] - 0.03 : 0.97;
    t.cols[ci] = Math.min(hi, Math.max(lo, (ev.clientX - r.left) / r.width));
    h.style.left = pct(t.cols[ci]);
  };
  const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); changed(); };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up);
}

document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => {
  S.mode = b.dataset.mode;
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x === b));
  drawZones();
}));
$('undo').addEventListener('click', () => {
  const h = S.hist[S.cur];
  if (!h || !h.length) return;
  Object.assign(page(), JSON.parse(h.pop()));
  S.sel = -1;
  changed();
});
$('addCol').addEventListener('click', () => {
  const ts = page().tables;
  const t = ts[S.sel >= 0 ? S.sel : ts.length - 1];
  if (!t) return;
  snapshot();
  const c = [0, ...t.cols, 1];
  let g = 0, k = 0;
  for (let i = 0; i < c.length - 1; i++) if (c[i + 1] - c[i] > g) { g = c[i + 1] - c[i]; k = i; }
  t.cols.push((c[k] + c[k + 1]) / 2);
  t.cols.sort((a, b) => a - b);
  changed();
});
$('prev').addEventListener('click', () => { if (!S.busy && S.cur > 0) showPage(S.cur - 1); });
$('next').addEventListener('click', () => { if (!S.busy && S.cur < S.doc.pages.length - 1) showPage(S.cur + 1); });

function estimate(n) {
  const s = n * 6;
  if (s < 60) return 'meno di un minuto';
  const m = Math.round(s / 60);
  return m === 1 ? 'circa un minuto' : `circa ${m} minuti`;
}
function updateReadButton() {
  const d = S.doc, tot = d.pages.length, n = d.pages.filter((p) => !p.skip).length;
  $('read').textContent = d.result ? (d.stale ? 'Leggi di nuovo il testo' : 'Vai al testo') : 'Leggi il testo';
  if (d.result && !d.stale) $('readNote').textContent = '';
  else if (!n) $('readNote').textContent = 'Nessuna pagina selezionata: spunta almeno una pagina a sinistra.';
  else $('readNote').textContent = `${n === tot ? (n === 1 ? '1 pagina' : `Tutte le ${n} pagine`) : `${n} ${n === 1 ? "pagina" : "pagine"} su ${tot}`}, ${estimate(n)}.`;
}

$('read').addEventListener('click', async () => {
  const d = S.doc;
  if (d.result && !d.stale) return go(3);
  const todo = d.pages.map((p, i) => (p.skip ? -1 : i)).filter((i) => i >= 0);
  if (!todo.length) { $('readNote').textContent = 'Nessuna pagina selezionata: spunta almeno una pagina a sinistra.'; return; }
  if (d.result && d.html && !confirm('Leggendo di nuovo il testo, le correzioni che hai fatto a mano andranno perse. Continuare?')) return;
  S.busy = true;
  renderTabs();
  $('read').disabled = true;
  const thumbs = [...$('thumbs').children];
  thumbs.forEach((t) => t.classList.remove('done'));
  const pages = d.pages.map(() => null);
  try {
    for (let k = 0; k < todo.length; k++) {
      const i = todo[k];
      showPage(i);
      const th = thumbs[i], scan = th.querySelector('.scan');
      th.classList.add('reading');
      $('readNote').textContent = `Lettura della pagina ${i + 1} (${k + 1} di ${todo.length})…`;
      const canvas = await pageForOcr(S.pdf, i + 1, d.pages[i].skew);
      pages[i] = await readPage(canvas, d.pages[i], (f) => { scan.style.top = `${Math.min(97, f * 100)}%`; });
      th.classList.remove('reading');
      th.classList.add('done');
    }
    d.result = { pages };
    d.html = null;
    d.stale = false;
    await saveDoc(d);
    S.busy = false;
    $('read').disabled = false;
    go(3);
  } catch (e) {
    console.error(e);
    S.busy = false;
    $('read').disabled = false;
    thumbs.forEach((t) => t.classList.remove('reading'));
    renderTabs();
    $('readNote').textContent = 'La lettura si è interrotta. Controlla la connessione la prima volta che usi il sito, poi riprova.';
  }
});

// ---------- passo 3: testo pronto ----------
const editor = $('editor'), left = $('left');

function buildHtml(result) {
  let first = true;
  return result.pages.map((items, p) => {
    if (!items) return '';
    let h = first ? '' : `<div class="pbreak" contenteditable="false" data-k="pg-${p}">Pagina ${p + 1}</div>`;
    first = false;
    items.forEach((it, i) => {
      const k = `${p}-${i}`;
      if (it.type === 'p') h += `<p data-k="${k}">${tokensToHtml(it.tokens)}</p>`;
      else h += `<table data-k="${k}">${it.rows.map((r) => `<tr>${r.map((c) => `<td>${tokensToHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    });
    return h;
  }).join('');
}

function enterResult() {
  const d = S.doc;
  $('msg3').textContent = '';
  left.innerHTML = d.result.pages.map((items, p) => (items ? `<div class="rpage" data-k="pg-${p}"><img src="${S.urls[p]}" alt="Pagina ${p + 1}" data-p="${p}">${
    items.map((it, i) => `<div class="anchor" data-k="${p}-${i}" style="left:${pct(it.box.x)};top:${pct(it.box.y)};width:${pct(it.box.w)};height:${pct(it.box.h)}"></div>`).join('')}</div>` : '')).join('');
  editor.innerHTML = d.html || buildHtml(d.result);
  left.style.setProperty('--z', S.z3);
  if (S.z3 > 1) hiResLeft();
  zoom3.show();
  left.scrollTop = 0;
  editor.scrollTop = 0;
}

function hiResLeft() {
  left.querySelectorAll('img[data-p]').forEach((img) => {
    const p = +img.dataset.p;
    hiRes(p).then((u) => { if (u && S.z3 > 1 && img.isConnected) img.src = u; });
  });
}
const zoom3 = zoomBar($('zoom3'), () => S.z3, (z) => {
  keepCenter(left, () => { S.z3 = z; left.style.setProperty('--z', z); });
  if (z > 1) hiResLeft();
});
wheelZoom(left, zoom3);

// scorrimento sincronizzato, ancorato paragrafo per paragrafo
const topIn = (el, pane) => el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
const quiet = { left: 0, editor: 0 };
function sync(from, to) {
  if (performance.now() - quiet[from.id] < 90) return;
  const sel = '[data-k]';
  const els = [...from.querySelectorAll(sel)].map((el) => ({ el, top: topIn(el, from) })).sort((a, b) => a.top - b.top);
  if (!els.length) return;
  const y = from.scrollTop + 12;
  let cur = els[0];
  for (const e of els) { if (e.top <= y) cur = e; else break; }
  const target = to.querySelector(`[data-k="${cur.el.dataset.k}"]`);
  if (!target) return;
  const f = Math.max(-0.5, Math.min(1.5, (y - cur.top) / Math.max(1, cur.el.offsetHeight)));
  quiet[to.id] = performance.now();
  to.scrollTop = topIn(target, to) + f * target.offsetHeight - 12;
}
editor.addEventListener('scroll', () => sync(editor, left));
left.addEventListener('scroll', () => sync(left, editor));

editor.addEventListener('mouseover', (e) => {
  const el = e.target.closest && e.target.closest('[data-k]');
  left.querySelectorAll('.anchor.hi').forEach((a) => a.classList.remove('hi'));
  if (el) left.querySelector(`.anchor[data-k="${el.dataset.k}"]`)?.classList.add('hi');
});
editor.addEventListener('mouseleave', () => left.querySelectorAll('.anchor.hi').forEach((a) => a.classList.remove('hi')));

// quando una parola gialla viene corretta, il giallo sparisce
editor.addEventListener('input', () => {
  const sel = getSelection();
  const n = sel.anchorNode;
  const m = n && (n.nodeType === 1 ? n : n.parentElement)?.closest('mark');
  if (m && editor.contains(m)) {
    const off = sel.anchorOffset;
    const tn = n;
    m.replaceWith(...m.childNodes);
    try { const r = document.createRange(); r.setStart(tn, Math.min(off, tn.length ?? off)); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); } catch { /* il cursore resta dov'è */ }
  }
  S.doc.html = editor.innerHTML;
  saveSoon();
});

$('copy').addEventListener('click', async () => {
  const blocks = blocksFromEditor(editor);
  const html = blocksToHtml(blocks), text = blocksToText(blocks);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    $('msg3').textContent = 'Testo copiato. Ora puoi incollarlo in Word con Ctrl+V.';
  } catch {
    try { await navigator.clipboard.writeText(text); $('msg3').textContent = 'Testo copiato. Ora puoi incollarlo in Word con Ctrl+V.'; }
    catch { $('msg3').textContent = 'La copia automatica non è riuscita: seleziona il testo a destra e premi Ctrl+C.'; }
  }
});

$('docx').addEventListener('click', async () => {
  const blob = await blocksToDocx(blocksFromEditor(editor));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${S.doc.name}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  $('msg3').textContent = `File "${S.doc.name}.docx" scaricato nella cartella Download.`;
});

// ---------- avvio ----------
cleanup().catch(() => {}).finally(() => go(1));
