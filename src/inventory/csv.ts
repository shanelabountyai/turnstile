// A small RFC 4180 reader for the fixture CSVs (task 1.4). Own code: the ask-before-add list in CLAUDE.md names
// CSV parsers, and Python's csv module writes plain comma-separated rows with double-quote quoting, which this reads.
import { InputInvalid } from './errors';

export function parseCsv(text: string, field = 'csv'): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const src = text.endsWith('\n') ? text : text + '\n';
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (quoted) throw new InputInvalid(field, 'unterminated quote');
  if (rows.length === 0) return [];
  const header = rows[0]!;
  return rows.slice(1).filter((r) => !(r.length === 1 && r[0] === '')).map((r, n) => {
    if (r.length !== header.length) throw new InputInvalid(`${field}:${n + 2}`, `expected ${header.length} fields, got ${r.length}`);
    return Object.fromEntries(header.map((h, k) => [h, r[k]!]));
  });
}
