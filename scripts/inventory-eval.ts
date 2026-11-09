// inventory:eval (task 1.10): run the engine over fixtures/, print the brief §11 table in the oracle's field order
// (tools/reference_alloc.py print_table), diff every row of the seven expected files, exit non-zero on the first
// difference. The only product-side reader of expected_* (non-negotiable 9).
import { existsSync, readFileSync } from 'node:fs';
import { parseCsv } from '../src/inventory/csv';
import { Engine } from '../src/inventory/engine';
import { loadCommands, loadEvent } from '../src/inventory/load';
import { COLUMNS, firstDiff, tables, type TableName } from '../src/inventory/tables';

const FX = process.argv[2] ?? 'fixtures';
if (!existsSync(`${FX}/commands.csv`)) {
  console.log('0 commands');
  process.exit(0);
}
const ev = loadEvent(FX);
const cmds = loadCommands(FX);
const e = new Engine(ev);
e.run(cmds);
const t = tables(e);
const s = t.summary;

console.log(`== Turnstile reference run — ${ev.name}`);
console.log(`commands ${s.commands} · ok ${s.ok} · rejected ${s.rejected}`);
console.log('-- by code');
for (const code of Object.keys(s.by_code).sort((a, b) => s.by_code[b]! - s.by_code[a]! || (a < b ? -1 : a > b ? 1 : 0))) console.log(`  ${code.padEnd(28)} ${String(s.by_code[code]).padStart(5)}`);
console.log('-- inventory (end state)');
console.log(`  ${'scope'.padEnd(5)} ${'id'.padEnd(8)} ${'capacity'.padStart(8)} ${'sold'.padStart(5)} ${'held'.padStart(5)} ${'refunded'.padStart(8)} ${'remaining'.padStart(9)} ${'available'.padStart(9)}`);
for (const r of t.expected_inventory) console.log(`  ${r.scope!.padEnd(5)} ${r.id!.padEnd(8)} ${r.capacity!.padStart(8)} ${r.sold!.padStart(5)} ${r.held!.padStart(5)} ${r.refunded!.padStart(8)} ${r.remaining!.padStart(9)} ${r.available!.padStart(9)}`);
console.log(`-- orders ${s.orders} · tickets issued ${s.tickets_issued} · live ${s.tickets_live} · refunded ${s.tickets_refunded} · checked in ${s.checked_in}`);
console.log(`-- money (cents): captured ${s.captured_cents} · refunded ${s.refunded_cents} · net ${s.net_cents} · refunds ${s.refunds}`);
const byReason = new Map<string, [number, number]>();
for (const r of t.expected_refunds) {
  const k = r.reason!.startsWith('CUSTOMER') ? 'CUSTOMER' : r.reason!;
  const v = byReason.get(k) ?? [0, 0];
  v[0]++; v[1] += Number(r.amount_cents);
  byReason.set(k, v);
}
for (const k of [...byReason.keys()].sort()) console.log(`  refunds ${k.padEnd(20)} ${String(byReason.get(k)![0]).padStart(4)}  ${String(byReason.get(k)![1]).padStart(9)}`);
console.log('-- holds');
for (const k of Object.keys(s.holds).sort()) console.log(`  ${k.padEnd(22)} ${String(s.holds[k]).padStart(5)}`);
console.log(`-- waitlist: entries ${t.expected_waitlist.length} · offers made ${s.offers_made}`);
for (const k of Object.keys(s.waitlist).sort()) console.log(`  ${k.padEnd(22)} ${String(s.waitlist[k]).padStart(5)}`);
console.log(`-- commitment ${s.commitment}`);

let failed: string | null = null;
for (const name of Object.keys(COLUMNS) as TableName[]) {
  const want = parseCsv(readFileSync(`${FX}/${name}.csv`, 'utf8'), name);
  const d = firstDiff(name, t[name], want, COLUMNS[name]);
  if (d && !failed) failed = d;
}
const wantSummary = JSON.parse(readFileSync(`${FX}/expected_summary.json`, 'utf8')) as Record<string, unknown>;
if (!failed) {
  for (const k of Object.keys(wantSummary).sort()) {
    const got = (s as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(got, got && typeof got === 'object' ? Object.keys(got).sort() : undefined) !== JSON.stringify(wantSummary[k], wantSummary[k] && typeof wantSummary[k] === 'object' ? Object.keys(wantSummary[k] as object).sort() : undefined)) { failed = `expected_summary.json: ${k} differs`; break; }
  }
}
if (failed) {
  console.error(`DIFFERS: ${failed}`);
  process.exit(1);
}
console.log(`eval: 7 expected files and expected_summary.json match (${s.commands} commands)`);
