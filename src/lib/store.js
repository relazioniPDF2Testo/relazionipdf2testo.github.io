// Archivio dei documenti nel browser (IndexedDB). Nulla lascia il computer.
// Ogni documento si cancella da solo 30 giorni dopo l'ultima apertura.

export const KEEP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('relazioni', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('docs', mode);
    const out = fn(t.objectStore('docs'));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const saveDoc = (doc) => tx('readwrite', (s) => s.put(doc));
export const getDoc = (id) => tx('readonly', (s) => s.get(id));
export const deleteDoc = (id) => tx('readwrite', (s) => s.delete(id));
export const allDocs = () => tx('readonly', (s) => s.getAll());

export function daysLeft(doc) {
  return Math.max(0, Math.ceil((doc.lastOpened + KEEP_DAYS * DAY - Date.now()) / DAY));
}

export async function cleanup() {
  const docs = await allDocs();
  for (const d of docs) if (Date.now() - d.lastOpened > KEEP_DAYS * DAY) await deleteDoc(d.id);
}

export async function askPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* facoltativo */ }
}
