// Copia in public/tesseract i file di Tesseract (worker, motore WebAssembly, modello italiano),
// così il sito non dipende da CDN esterne.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'tesseract');

mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

cpSync(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'));

const coreDir = join(nm, 'tesseract.js-core');
for (const f of readdirSync(coreDir)) {
  if (f.endsWith('.wasm.js')) cpSync(join(coreDir, f), join(out, 'core', f));
}

// Modello "best_int": solo LSTM, quantizzato, buon compromesso tra precisione e velocità.
cpSync(
  join(nm, '@tesseract.js-data', 'ita', '4.0.0_best_int', 'ita.traineddata.gz'),
  join(out, 'lang', 'ita.traineddata.gz'),
);

console.log('Asset di Tesseract copiati in public/tesseract');
