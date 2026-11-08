// Post-elaborazione del testo letto: correzioni tipiche nei numeri, unità di misura,
// parole spezzate a fine riga, segnalazione delle parole incerte.

const UNITS = new Map([
  ['mg/dl', 'mg/dL'], ['g/dl', 'g/dL'], ['mmhg', 'mmHg'], ['u/l', 'U/L'], ['ui/l', 'UI/L'],
  ['meq/l', 'mEq/L'], ['mmol/l', 'mmol/L'], ['ml/min', 'mL/min'], ['ng/ml', 'ng/mL'],
  ['pg/ml', 'pg/mL'], ['µg/l', 'µg/L'], ['mcg/l', 'mcg/L'], ['bpm', 'bpm'],
]);

const hasDigit = (s) => /\d/.test(s);

// Corregge le confusioni classiche dentro i numeri: O→0, l/I/|→1, S→5 tra cifre.
export function fixToken(t) {
  let s = t.replace(/^[«»"„“]+(?=[<>≤≥])/, '');
  if (hasDigit(s)) {
    s = s
      .replace(/(?<=\d)[Oo](?=[\d,.]|$)/g, '0')
      .replace(/(?<=[\d,.])[Oo](?=\d)/g, '0')
      .replace(/(?<=\d)[lI|](?=\d)/g, '1')
      .replace(/^[lI|](?=\d)/, '1')
      .replace(/(?<=\d)[S](?=\d)/g, '5');
  }
  const m = s.match(/^([^A-Za-zµ]*)([A-Za-zµ]+\/[A-Za-z]+(?:\/[A-Za-z]+)?|mmhg|bpm)([^A-Za-z]*)$/i);
  if (m) {
    const u = UNITS.get(m[2].toLowerCase());
    if (u) s = m[1] + u + m[3];
  }
  return { t: s, changed: s !== t };
}

// Una parola è "incerta" se la confidenza è bassa; per i numeri la soglia è più alta,
// perché un valore sbagliato in una relazione medica è l'errore peggiore.
export function isUncertain(text, conf, changed) {
  if (changed) return true;
  if (hasDigit(text)) return conf < 88;
  return conf < 65;
}

// Trasforma le righe di un paragrafo in una sequenza di parole, ricucendo
// le parole spezzate col trattino a fine riga ("ripolariz- zazione" → "ripolarizzazione").
export function joinLines(lines) {
  const out = [];
  for (let li = 0; li < lines.length; li++) {
    const words = lines[li];
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      const prev = out[out.length - 1];
      if (wi === 0 && prev && prev.hyph && /^[a-zàèéìòù]/.test(w.t)) {
        prev.t = prev.t.replace(/[-¬]$/, '') + w.t;
        prev.u = prev.u || w.u;
        prev.hyph = false;
        continue;
      }
      out.push({ t: w.t, u: w.u, hyph: wi === words.length - 1 && /[A-Za-zàèéìòù][-¬]$/.test(w.t) });
    }
  }
  return out.map(({ t, u }) => ({ t, u }));
}

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function tokensToHtml(tokens) {
  return tokens
    .map((w) => (w.u ? `<mark title="Controlla questa parola sul documento">${esc(w.t)}</mark>` : esc(w.t)))
    .join(' ');
}
