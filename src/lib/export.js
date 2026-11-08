import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';

// Il contenuto del testo, letto dall'editor così include le correzioni fatte a mano.
// Restituisce blocchi { type: 'p', text } oppure { type: 'table', rows: [[text]] }.
export function blocksFromEditor(editor) {
  const out = [];
  for (const el of editor.children) {
    if (el.classList.contains('pbreak')) continue;
    if (el.tagName === 'TABLE') {
      const rows = [...el.rows].map((r) => [...r.cells].map((c) => c.innerText.trim()));
      if (rows.length) out.push({ type: 'table', rows });
    } else {
      const text = el.innerText.replace(/\s+\n/g, '\n').trim();
      if (text) out.push({ type: 'p', text });
    }
  }
  return out;
}

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function blocksToHtml(blocks) {
  return blocks.map((b) => (b.type === 'p'
    ? `<p>${escHtml(b.text).replace(/\n/g, '<br>')}</p>`
    : `<table border="1" style="border-collapse:collapse">${b.rows.map((r) => `<tr>${r.map((c) => `<td style="padding:2px 6px">${escHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`)).join('\n');
}

export function blocksToText(blocks) {
  return blocks.map((b) => (b.type === 'p' ? b.text : b.rows.map((r) => r.join('\t')).join('\n'))).join('\n\n');
}

export async function blocksToDocx(blocks) {
  const line = { style: BorderStyle.SINGLE, size: 4, color: '9AA9B1' };
  const children = [];
  for (const b of blocks) {
    if (b.type === 'p') {
      const parts = b.text.split('\n');
      children.push(new Paragraph({
        spacing: { after: 160 },
        children: parts.map((t, i) => new TextRun({ text: t, break: i ? 1 : 0 })),
      }));
    } else {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
        rows: b.rows.map((r) => new TableRow({
          children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })),
        })),
      }));
      children.push(new Paragraph(''));
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 24 } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
