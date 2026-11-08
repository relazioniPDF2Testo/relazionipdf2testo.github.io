// Elaborazione delle immagini delle pagine: scala di grigi, soglia, raddrizzamento,
// riconoscimento di loghi/timbri/firme da proporre come zone da coprire.

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function scaledCopy(src, maxW) {
  const k = Math.min(1, maxW / src.width);
  const c = makeCanvas(src.width * k, src.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function grayOf(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  }
  return { g, w, h };
}

// Soglia di Otsu: massimizza la varianza tra le classi
// σ_B²(t) = ω₀(t)·ω₁(t)·[μ₀(t) − μ₁(t)]²
export function otsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const n = g.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let w0 = 0, sum0 = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    w0 += hist[t];
    if (!w0) continue;
    const w1 = n - w0;
    if (!w1) break;
    sum0 += t * hist[t];
    const m0 = sum0 / w0, m1 = (sum - sum0) / w1;
    const v = w0 * w1 * (m0 - m1) * (m0 - m1);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

export function binarize({ g, w, h }) {
  const t = otsu(g);
  const b = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) b[i] = g[i] <= t ? 1 : 0;
  return { b, w, h };
}

// Stima dell'inclinazione col profilo di proiezione:
// θ* = argmax_θ Σ_y P_θ(y)²,  con  P_θ(y) = #{pixel neri con y·cosθ − x·sinθ ∈ bin y}.
// (Σ P² equivale alla varianza a meno di costanti, perché Σ P è fisso.)
// Restituisce θ* in gradi: le righe scendono verso destra se θ* > 0.
export function estimateSkew({ b, w, h }, maxDeg = 6) {
  const mx = Math.round(w * 0.04), my = Math.round(h * 0.04);
  const xs = [], ys = [];
  for (let y = my; y < h - my; y++) {
    const row = y * w;
    for (let x = mx; x < w - mx; x++) if (b[row + x]) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 500) return 0;
  // sottocampiona per velocità
  const step = Math.max(1, Math.floor(xs.length / 60000));
  const X = [], Y = [];
  for (let i = 0; i < xs.length; i += step) { X.push(xs[i]); Y.push(ys[i]); }
  const off = w + 10, nb = h + 2 * w + 20;
  const hist = new Float64Array(nb);
  const score = (deg) => {
    const r = (deg * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r);
    hist.fill(0);
    for (let i = 0; i < X.length; i++) hist[Math.round(Y[i] * c - X[i] * s + off)]++;
    let e = 0;
    for (let i = 0; i < nb; i++) e += hist[i] * hist[i];
    return e;
  };
  let best = 0, bestS = -1;
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += 0.5) {
    const s = score(d);
    if (s > bestS) { bestS = s; best = d; }
  }
  const c0 = best;
  for (let d = c0 - 0.5; d <= c0 + 0.5 + 1e-9; d += 0.05) {
    const s = score(d);
    if (s > bestS) { bestS = s; best = d; }
  }
  return Math.abs(best) < 0.1 ? 0 : Math.round(best * 100) / 100;
}

// Ruota la pagina di −θ attorno al centro, mantenendo le dimensioni e riempiendo di bianco.
export function straighten(src, skewDeg) {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (!skewDeg) { ctx.drawImage(src, 0, 0); return c; }
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((-skewDeg * Math.PI) / 180);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// Riconosce gli elementi grafici (loghi, timbri, firme, foto).
// Idea: "spalmatura" orizzontale (RLSA) che fonde le lettere di una riga in una barra;
// le righe di testo diventano componenti basse e larghe, mentre gli elementi grafici
// restano componenti molto più alte dell'altezza tipica di una riga.
export function detectFigures({ b, w, h }) {
  const gh = Math.max(3, Math.round(w * 0.012));
  const s = new Uint8Array(b);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (b[row + x]) {
        if (last >= 0 && x - last - 1 > 0 && x - last - 1 <= gh) s.fill(1, row + last + 1, row + x);
        last = x;
      }
    }
  }
  // etichettatura delle componenti connesse (8-connessione) con union-find
  const lab = new Int32Array(w * h);
  const parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, c) => { a = find(a); c = find(c); if (a !== c) parent[Math.max(a, c)] = Math.min(a, c); };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!s[i]) continue;
      const n = [];
      if (x > 0 && lab[i - 1]) n.push(lab[i - 1]);
      if (y > 0) {
        const u = i - w;
        if (lab[u]) n.push(lab[u]);
        if (x > 0 && lab[u - 1]) n.push(lab[u - 1]);
        if (x < w - 1 && lab[u + 1]) n.push(lab[u + 1]);
      }
      if (!n.length) { const l = parent.length; parent.push(l); lab[i] = l; }
      else { let m = n[0]; for (const k of n) m = Math.min(m, k); lab[i] = m; for (const k of n) unite(m, k); }
    }
  }
  const box = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l0 = lab[y * w + x];
      if (!l0) continue;
      const l = find(l0);
      let o = box.get(l);
      if (!o) { o = { x0: x, y0: y, x1: x, y1: y, n: 0 }; box.set(l, o); }
      if (x < o.x0) o.x0 = x; if (x > o.x1) o.x1 = x;
      if (y < o.y0) o.y0 = y; if (y > o.y1) o.y1 = y;
      o.n++;
    }
  }
  const comps = [...box.values()].map((o) => ({ ...o, bw: o.x1 - o.x0 + 1, bh: o.y1 - o.y0 + 1 }));
  const lines = comps.filter((c) => c.bw > w * 0.03 && c.bh >= 3 && c.bh < h * 0.05).map((c) => c.bh).sort((a, c) => a - c);
  if (lines.length < 3) return [];
  const mh = lines[Math.floor(lines.length / 2)];
  const edge = 3;
  let cand = comps.filter((c) =>
    c.bh > 2.6 * mh && c.bw > w * 0.04 && c.bh < h * 0.3 &&
    !(c.bw > w * 0.5 && c.bh > h * 0.15) &&
    c.x0 > edge && c.y0 > edge && c.x1 < w - edge && c.y1 < h - edge);
  // unisci le zone che si sovrappongono (con un margine)
  const pad = Math.round(mh * 0.6);
  let rects = cand.map((c) => ({ x0: c.x0 - pad, y0: c.y0 - pad, x1: c.x1 + pad, y1: c.y1 + pad }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], c = rects[j];
        if (a.x0 <= c.x1 && c.x0 <= a.x1 && a.y0 <= c.y1 && c.y0 <= a.y1) {
          rects[i] = { x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) };
          rects.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  const cl = (v) => Math.max(0, Math.min(1, v));
  return rects.map((r) => {
    const x = cl(r.x0 / w), y = cl(r.y0 / h);
    return { x, y, w: cl(r.x1 / w) - x, h: cl(r.y1 / h) - y, auto: true };
  });
}

// Propone le linee di colonna di una tabella: profilo verticale V(x) = Σ_y I(x, y)
// dentro la zona; le colonne sono separate da fasce in cui V(x) ≈ 0 larghe almeno w_min.
export function detectColumns(img, r) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const x0 = Math.round(r.x * W), y0 = Math.round(r.y * H);
  const w = Math.max(2, Math.round(r.w * W)), h = Math.max(2, Math.round(r.h * H));
  const c = makeCanvas(w, h);
  c.getContext('2d').drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const { b } = binarize(grayOf(c));
  const V = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) V[x] += b[y * w + x];
  const thr = Math.max(1, h * 0.01);
  const wmin = Math.max(4, W * 0.015);
  // ignora i bordi bianchi a sinistra e a destra
  let a = 0; while (a < w && V[a] <= thr) a++;
  let z = w - 1; while (z > a && V[z] <= thr) z--;
  const seps = [];
  let start = -1;
  for (let x = a; x <= z; x++) {
    if (V[x] <= thr) { if (start < 0) start = x; }
    else if (start >= 0) { if (x - start >= wmin) seps.push((start + x) / 2 / w); start = -1; }
  }
  return seps.length ? seps.slice(0, 8) : [0.5];
}

export function canvasToBlob(canvas, type = 'image/jpeg', q = 0.86) {
  return new Promise((res) => canvas.toBlob(res, type, q));
}
