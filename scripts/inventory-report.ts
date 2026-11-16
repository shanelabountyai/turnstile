// Shared by inventory:eval and inventory:eval:db: the brief §11 table in the oracle's field order
// (tools/reference_alloc.py print_table) and the diff against the seven expected files + expected_summary.json.
// The only product-side reader of expected_* (non-negotiable 9).
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/inventory/csv';
import { COLUMNS, firstDiff, type Tables, type TableName } from '../src/inventory/tables';

export function printReport(name: string, t: Tables): void {
  const s = t.summary;
  console.log(`== Turnstile reference run — ${name}`);
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
}

const canon = (v: unknown) => JSON.stringify(v, v && typeof v === 'object' ? Object.keys(v as object).sort() : undefined);

/** First difference against fixtures/expected_*, or null when all seven files and the summary match. */
export function diffExpected(fx: string, t: Tables): string | null {
  for (const name of Object.keys(COLUMNS) as TableName[]) {
    const d = firstDiff(name, t[name], parseCsv(readFileSync(`${fx}/${name}.csv`, 'utf8'), name), COLUMNS[name]);
    if (d) return d;
  }
  const want = JSON.parse(readFileSync(`${fx}/expected_summary.json`, 'utf8')) as Record<string, unknown>;
  for (const k of Object.keys(want).sort()) if (canon((t.summary as unknown as Record<string, unknown>)[k]) !== canon(want[k])) return `expected_summary.json: ${k} differs`;
  return null;
}

/** First difference between two table sets (the recount from rows vs the replay of the log), or null. */
export function diffTables(a: Tables, b: Tables): string | null {
  for (const name of Object.keys(COLUMNS) as TableName[]) {
    const d = firstDiff(name, a[name], b[name], COLUMNS[name]);
    if (d) return d;
  }
  return a.summary.commitment === b.summary.commitment ? null : `commitment ${a.summary.commitment} vs ${b.summary.commitment}`;
}
