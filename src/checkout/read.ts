// The read model (task 3.2, D-31): what every Turnstile screen shows, from one place. Hydrate the engine from the
// stored rows, advance(at) in memory, project. Nothing is written: an expiry seen here is persisted by the next cast.
// No rule lives here — every count comes from the engine (`inventoryRows`, `summary`), so the formula exists once.
import { withOrg } from '@/core/db/rls';
import { compareStrings } from '@/inventory/canonical';
import { Engine } from '@/inventory/engine';
import { rowKey } from '@/inventory/event';
import type { Timestamp } from '@/inventory/time';
import { engineState, eventDef, loadRows } from './cast';

export type SoldOut = 'SOLD_OUT_POOL' | 'SOLD_OUT_TIER' | null;

export interface EventView {
  asOf: Timestamp;
  event: { eventKey: string; name: string; venue: string; startsAt: Timestamp; doorsAt: Timestamp; cancelledAt: Timestamp | null };
  pools: { pool: string; kind: string; capacity: number; sold: number; held: number; refunded: number; remaining: number }[];
  /** `available = min(tierRemaining, poolRemaining)`; both inputs shown so a screen can explain the number. */
  tiers: {
    tier: string; pool: string; priceCents: number; onSaleAt: Timestamp; offSaleAt: Timestamp; onSale: boolean;
    allotment: number; sold: number; held: number; refunded: number; remaining: number; poolRemaining: number; available: number; soldOut: SoldOut;
  }[];
  sections: { section: string; pool: string; rows: { row: string; seats: { seat: string; num: number; state: 'OPEN' | 'HELD' | 'SOLD' }[] }[] }[];
  /** Live entries per target. `position` is 1-based FIFO by (joined_at, entry_id) among WAITING; 1 is the head. */
  waitlists: { target: string; waiting: { entry: string; customer: string; qty: number; joinedAt: Timestamp; position: number }[]; offered: { entry: string; customer: string; qty: number; offer: string; expiresAt: Timestamp }[] }[];
  orders: { order: string; customer: string; tier: string; qty: number; seats: string[]; grossCents: number; feesCents: number; refundedCents: number; confirmedAt: Timestamp; viaOffer: boolean; tickets: string[] }[];
  ledger: { capturedCents: number; refundedCents: number; netCents: number; refunds: number; ticketsLive: number; checkedIn: number };
}

/** Pure projection of an engine at `asOf`. Exported for the fixture test (no database). */
export function eventView(e: Engine, asOf: Timestamp): EventView {
  const inv = e.inventoryRows();
  const poolRow = new Map(inv.filter((r) => r.scope === 'pool').map((r) => [r.id, r]));
  const s = e.summary();
  const byTarget = new Map<string, EventView['waitlists'][number]>();
  const waiting = e.waitlist.filter((w) => w.state === 'WAITING').sort((a, b) => compareStrings(a.joined_at, b.joined_at) || compareStrings(a.entry_id, b.entry_id));
  const list = (t: string) => byTarget.get(t) ?? byTarget.set(t, { target: t, waiting: [], offered: [] }).get(t)!;
  for (const w of waiting) { const l = list(w.target); l.waiting.push({ entry: w.entry_id, customer: w.customer, qty: w.qty, joinedAt: w.joined_at, position: l.waiting.length + 1 }); }
  for (const w of e.waitlist) if (w.state === 'OFFERED') list(w.target).offered.push({ entry: w.entry_id, customer: w.customer, qty: w.qty, offer: w.offer_id!, expiresAt: e.holds.get(w.offer_id!)!.expires_at });

  return {
    asOf,
    event: { eventKey: e.ev.event_id, name: e.ev.name, venue: e.ev.venue, startsAt: e.ev.starts_at, doorsAt: e.ev.doors_at, cancelledAt: e.cancelledAt },
    pools: [...poolRow.values()].map((r) => ({ pool: r.id, kind: e.pools.get(r.id)!.kind, capacity: r.capacity, sold: r.sold, held: r.held, refunded: r.refunded, remaining: r.remaining })),
    tiers: inv.filter((r) => r.scope === 'tier').map((r) => {
      const t = e.tiers.get(r.id)!;
      const poolRemaining = poolRow.get(r.pool)!.remaining;
      // Same precedence as a HOLD's reject (non-negotiable 2): the pool is checked before the tier.
      const soldOut: SoldOut = r.available > 0 ? null : poolRemaining <= 0 ? 'SOLD_OUT_POOL' : 'SOLD_OUT_TIER';
      return { tier: r.id, pool: r.pool, priceCents: t.price_cents, onSaleAt: t.on_sale_at, offSaleAt: t.off_sale_at, onSale: e.tierOnSale(r.id, asOf),
        allotment: r.capacity, sold: r.sold, held: r.held, refunded: r.refunded, remaining: r.remaining, poolRemaining, available: r.available, soldOut };
    }),
    sections: e.ev.sections.map((sec) => ({
      section: sec.section_id, pool: sec.pool_id,
      rows: sec.rows.map((row) => ({ row, seats: e.rows.get(rowKey(sec.section_id, row))!.map((id) => { const st = e.seats.get(id)!; return { seat: id, num: st.num, state: st.state }; }) })),
    })),
    waitlists: [...byTarget.values()].sort((a, b) => compareStrings(a.target, b.target)),
    orders: [...e.orders.values()].sort((a, b) => compareStrings(a.order_id, b.order_id)).map((o) => ({
      order: o.order_id, customer: o.customer, tier: o.tier, qty: o.qty, seats: o.seats, grossCents: o.gross_cents, feesCents: o.fees_cents,
      refundedCents: o.tickets.reduce((n, t) => n + e.tickets.get(t)!.refunded_cents, 0), confirmedAt: o.confirmed_at, viaOffer: o.via_offer, tickets: o.tickets,
    })),
    ledger: { capturedCents: s.captured_cents, refundedCents: s.refunded_cents, netCents: s.net_cents, refunds: s.refunds, ticketsLive: s.tickets_live, checkedIn: s.checked_in },
  };
}

/**
 * The event as of `at` (normally `axisNow`, D-34). Takes the cast's pool locks in shared mode, so the rows are read
 * between casts, never mid-delta; readers do not block each other. If `at` is before the log's last command the view
 * is as of that command instead (the engine cannot run backwards).
 */
export async function readEvent(orgId: string, eventId: string, at: Timestamp): Promise<EventView> {
  const { rows, last } = await withOrg({ orgId }, async (tx) => {
    const pools = await tx.pool.findMany({ where: { eventId }, select: { poolId: true }, orderBy: { poolId: 'asc' } });
    for (const p of pools) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`${eventId}:${p.poolId}`}))`;
    const l = await tx.commandLog.findFirst({ where: { eventId }, orderBy: [{ at: 'desc' }, { cmdId: 'desc' }], select: { at: true } });
    return { rows: await loadRows(tx, eventId), last: (l?.at ?? null) as Timestamp | null };
  });
  const e = new Engine(eventDef(rows.event)).hydrate(engineState(rows, last));
  const asOf = last && compareStrings(at, last) < 0 ? last : at;
  e.advance(asOf);
  return eventView(e, asOf);
}
