// inventory:eval:db (task 2.6, D-28): the 2,662 fixture commands through the cast path with Stripe recorded, then
// two recounts — (a) the engine hydrated from the stored rows, (b) a fresh pure engine replaying the CommandLog —
// diffed against each other, against the seven expected files and against the Phase 1 commitment. Empties the
// Turnstile rows of the test database first (it refuses any database whose name does not end in _test).
import { engineState, eventDef, loadRows } from '@/checkout/cast';
import { loadFixtureEvent } from '@/checkout/load';
import { readEvent } from '@/checkout/read';
import { db } from '@/core/db';
import { withOrg } from '@/core/db/rls';
import { Engine } from '@/inventory/engine';
import { loadEvent } from '@/inventory/load';
import { tables } from '@/inventory/tables';
import type { Command, Result } from '@/inventory/types';
import type { Timestamp } from '@/inventory/time';
import { castFixture } from './cast-fixture';
import { diffExpected, diffTables, printReport } from './inventory-report';

const FX = process.argv[2] ?? 'fixtures';
const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? '')?.[1] ?? '';
if (!dbName.endsWith('_test')) {
  console.error(`inventory:eval:db empties Turnstile rows and runs only against a *_test database (got "${dbName}")`);
  process.exit(2);
}

const t0 = Date.now();
// Empty every Turnstile table first. TRUNCATE, not DELETE: the D-21 row triggers refuse deletes (by design) and do
// not fire on TRUNCATE — the same escape the foundation's audit trigger leaves for tests. Then the org itself.
await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
await db.org.deleteMany({ where: { slug: 'eval' } });
const org = await db.org.create({ data: { slug: 'eval', name: 'inventory:eval:db' } });
const { eventId } = await loadFixtureEvent(org.id, FX);
const ev = loadEvent(FX);
const { cmds, results, stripe } = await castFixture(org.id, eventId, FX, (n, total) => console.error(`  ${n}/${total} cast (${((Date.now() - t0) / 1000).toFixed(1)} s)`));
const castSeconds = (Date.now() - t0) / 1000;

// (a) recount from the stored rows: hydrate, then the same tables the Phase 1 engine prints
const { rows, log } = await withOrg({ orgId: org.id }, async (tx) => ({ rows: await loadRows(tx, eventId), log: await tx.commandLog.findMany({ where: { eventId }, orderBy: [{ at: 'asc' }, { cmdId: 'asc' }] }) }), { atomic: false });
const logResults: Result[] = log.map((l) => ({ cmd_id: l.cmdId, at: l.at as Timestamp, kind: l.kind, customer: l.customer, status: l.status, code: l.code, detail: l.detail }));
const recount = tables(new Engine(eventDef(rows.event)).hydrate(engineState(rows, (log.at(-1)?.at ?? null) as Timestamp | null, logResults)));
// (b) replay the log through a fresh pure engine
const replay = new Engine(ev);
replay.run(log.map((l) => l.payload as unknown as Command));
const replayed = tables(replay);

printReport(`${ev.name} (recount from rows)`, recount);
// (c) the read model the screens use (task 3.2, D-31): same ledger and the same available per tier as the recount
const view = await readEvent(org.id, eventId, log.at(-1)!.at as Timestamp);
const viewInv = view.tiers.map((t) => `${t.tier}:${t.sold}/${t.held}/${t.remaining}/${t.available}`).join(' ');
const recInv = recount.expected_inventory.filter((r) => r.scope === 'tier').map((r) => `${r.id}:${r.sold}/${r.held}/${r.remaining}/${r.available}`).join(' ');
const viewLedger = `${view.ledger.capturedCents}/${view.ledger.refundedCents}/${view.ledger.netCents}`;
const recLedger = `${recount.summary.captured_cents}/${recount.summary.refunded_cents}/${recount.summary.net_cents}`;
const refunds = await db.refund.count({ where: { eventId } });
const pending = await db.refund.count({ where: { eventId, stripeRefundId: null } });
console.log(`-- stripe (recorded): ${stripe.calls.filter((c) => c.kind === 'paymentIntent').length} PaymentIntents · ${stripe.calls.filter((c) => c.kind === 'refund').length} refund calls · ${refunds} Refund rows, ${pending} pending provider`);
console.log(`-- cast: ${cmds.length} commands in ${castSeconds.toFixed(1)} s; CommandLog rows ${log.length}`);

const problems = [
  diffTables(recount, replayed) && `recount from rows vs log replay: ${diffTables(recount, replayed)}`,
  diffExpected(FX, recount) && `recount from rows vs expected_*: ${diffExpected(FX, recount)}`,
  viewInv !== recInv && `readEvent tiers ${viewInv} vs recount ${recInv}`,
  viewLedger !== recLedger && `readEvent ledger ${viewLedger} vs recount ${recLedger}`,
  results.length !== cmds.length && `${results.length} results for ${cmds.length} commands`,
  pending !== 0 && `${pending} refunds pending provider`,
].filter(Boolean);
await db.$disconnect();
if (problems.length) {
  for (const p of problems) console.error(`DIFFERS: ${p}`);
  process.exit(1);
}
console.log(`eval:db: readEvent = recount from rows = log replay = 7 expected files and expected_summary.json (${log.length} commands); commitment ${recount.summary.commitment}`);
