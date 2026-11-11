// The cast path (task 2.4, D-22, D-28): one transaction per command. Lock every pool of the event (sorted), rebuild
// the engine from the stored rows, run advance(at) + the command in memory, write the CommandLog row first and then
// only the rows that changed. The engine's rules are reused, not duplicated: this file is a storage adapter.
//
// Locking every pool of the event rather than "the pools the command touches": advance() and the waitlist fill can
// move inventory in any pool, and hydrate-and-delta needs the whole event state to be stable while it writes. At one
// event per org that is one lock per event. Recorded under D-22.
import type { Prisma } from '@/generated/prisma/client';
import { withOrg, type Tx } from '@/core/db/rls';
import { Engine } from '@/inventory/engine';
import { compareStrings } from '@/inventory/canonical';
import type { Command, EngineState, Hold, Order, Payment, Refund, Result, Ticket, WaitlistEntry } from '@/inventory/types';
import type { Timestamp } from '@/inventory/time';
import { eventNow, stampAfter } from './clock';

/** `clock`: stamp the command on the event clock at this wall instant, inside the lock (D-35, `stampAfter`), instead of trusting `cmd.at`. */
export type CastOptions = { stripeEventId?: string; clock?: Date };

type Rows = {
  event: Prisma.EventGetPayload<{ include: { pools: true; tiers: true; sections: true } }>;
  seats: Prisma.SeatGetPayload<object>[]; holds: Prisma.HoldGetPayload<object>[]; payments: Prisma.PaymentGetPayload<object>[];
  orders: Prisma.OrderGetPayload<object>[]; tickets: Prisma.TicketGetPayload<object>[]; entries: Prisma.WaitlistEntryGetPayload<object>[];
  refunds: Prisma.RefundGetPayload<object>[];
};

const ts = (v: string | null): Timestamp | null => v as Timestamp | null;

/** Everything the engine needs, from the rows. Exported for the recount (inventory:eval:db). */
export async function loadRows(tx: Tx, eventId: string): Promise<Rows> {
  const where = { eventId };
  const [event, seats, holds, payments, orders, tickets, entries, refunds] = await Promise.all([
    tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { pools: { orderBy: { ord: 'asc' } }, tiers: { orderBy: { ord: 'asc' } }, sections: { orderBy: { ord: 'asc' } } } }),
    tx.seat.findMany({ where }), tx.hold.findMany({ where }), tx.payment.findMany({ where }), tx.order.findMany({ where }),
    tx.ticket.findMany({ where }), tx.waitlistEntry.findMany({ where }), tx.refund.findMany({ where }),
  ]);
  return { event, seats, holds, payments, orders, tickets, entries, refunds };
}

export function eventDef(ev: Rows['event']): unknown {
  return {
    event_id: ev.eventKey, name: ev.name, venue: ev.venue, timezone_label: ev.timezoneLabel,
    starts_at: ev.startsAt, doors_at: ev.doorsAt, sales_open_at: ev.salesOpenAt, sales_close_at: ev.salesCloseAt,
    currency: ev.currency, ticket_salt: ev.ticketSalt, rules: ev.rules,
    pools: ev.pools.map((p) => ({ pool_id: p.poolId, kind: p.kind, capacity: p.capacity })),
    tiers: ev.tiers.map((t) => ({ tier_id: t.tierId, pool_id: t.poolId, allotment: t.allotment, price_cents: t.priceCents, on_sale_at: t.onSaleAt, off_sale_at: t.offSaleAt })),
    sections: ev.sections.map((s) => ({ section_id: s.sectionId, pool_id: s.poolId, rows: s.rows, seats_per_row: s.seatsPerRow })),
  };
}

export function engineState(r: Rows, now: Timestamp | null, results?: Result[]): EngineState {
  return {
    holds: r.holds.map((h) => ({
      hold_id: h.holdId, kind: h.kind, customer: h.customer, tier: h.tierId, qty: h.qty, seats: h.seats, state: h.state, created_at: h.createdAt as Timestamp,
      expires_at: h.expiresAt as Timestamp, price_cents: h.priceCents, fee_cents: h.feeCents, payment_id: h.paymentId, pay_started_at: ts(h.payStartedAt),
      pay_timeout_at: ts(h.payTimeoutAt), entry_id: h.entryId, order_id: h.orderId, ended_at: ts(h.endedAt),
    })),
    payments: r.payments.map((p) => ({ payment_id: p.paymentId, hold_id: p.holdId, amount_cents: p.amountCents, state: p.state, started_at: p.startedAt as Timestamp, ended_at: ts(p.endedAt) })),
    orders: r.orders.map((o) => ({
      order_id: o.orderId, customer: o.customer, tier: o.tierId, qty: o.qty, seats: o.seats, gross_cents: o.grossCents, fees_cents: o.feesCents,
      payment_id: o.paymentId, confirmed_at: o.confirmedAt as Timestamp, tickets: o.tickets, hold_id: o.holdId, via_offer: o.viaOffer,
    })),
    tickets: r.tickets.map((t) => ({
      ticket_id: t.ticketId, order_id: t.orderId, tier: t.tierId, seat: t.seat, price_cents: t.priceCents, fee_cents: t.feeCents, state: t.state,
      issued_at: t.issuedAt as Timestamp, checked_in_at: ts(t.checkedInAt), refunded_cents: t.refundedCents, ...(t.refundedAt ? { refunded_at: t.refundedAt as Timestamp } : {}), code: t.code,
    })),
    seats: r.seats.map((s) => ({ seat_id: s.seatId, state: s.state, hold_id: s.holdId, ticket_id: s.ticketId })),
    waitlist: r.entries.map((e) => ({
      entry_id: e.entryId, customer: e.customer, target: e.target, qty: e.qty, joined_at: e.joinedAt as Timestamp, state: e.state,
      offer_id: e.offerId, offered_at: ts(e.offeredAt), ended_at: ts(e.endedAt), order_id: e.orderId,
    })),
    refunds: r.refunds.map((x) => ({ refund_id: x.refundId, order_id: x.orderId, ticket_id: x.ticketId, payment_id: x.paymentId, amount_cents: x.amountCents, reason: x.reason, at: x.at as Timestamp })),
    results, cancelled_at: ts(r.event.cancelledAt), now,
  };
}

// ---- row shapes for the delta (engine record → Prisma data)
const holdRow = (h: Hold) => ({
  kind: h.kind, customer: h.customer, tierId: h.tier, qty: h.qty, seats: h.seats, state: h.state, createdAt: h.created_at, expiresAt: h.expires_at,
  priceCents: h.price_cents, feeCents: h.fee_cents, paymentId: h.payment_id, payStartedAt: h.pay_started_at, payTimeoutAt: h.pay_timeout_at,
  entryId: h.entry_id, orderId: h.order_id, endedAt: h.ended_at,
});
const paymentRow = (p: Payment) => ({ holdId: p.hold_id, amountCents: p.amount_cents, state: p.state, startedAt: p.started_at, endedAt: p.ended_at });
const orderRow = (o: Order) => ({
  customer: o.customer, tierId: o.tier, qty: o.qty, seats: o.seats, grossCents: o.gross_cents, feesCents: o.fees_cents, paymentId: o.payment_id,
  confirmedAt: o.confirmed_at, tickets: o.tickets, holdId: o.hold_id, viaOffer: o.via_offer,
});
const ticketRow = (t: Ticket) => ({
  orderId: t.order_id, tierId: t.tier, seat: t.seat, priceCents: t.price_cents, feeCents: t.fee_cents, state: t.state, issuedAt: t.issued_at,
  checkedInAt: t.checked_in_at, refundedCents: t.refunded_cents, refundedAt: t.refunded_at ?? null, code: t.code,
});
const entryRow = (e: WaitlistEntry) => ({
  customer: e.customer, target: e.target, qty: e.qty, joinedAt: e.joined_at, state: e.state, offerId: e.offer_id, offeredAt: e.offered_at, endedAt: e.ended_at, orderId: e.order_id,
});
const refundRow = (r: Refund) => ({ orderId: r.order_id, ticketId: r.ticket_id, paymentId: r.payment_id, amountCents: r.amount_cents, reason: r.reason, at: r.at });

const snap = <T>(items: Iterable<[string, T]>): Map<string, string> => new Map([...items].map(([k, v]) => [k, JSON.stringify(v)]));

/** Ids whose row is new or changed since `before`. */
function delta<T>(before: Map<string, string>, after: Iterable<[string, T]>): { created: [string, T][]; changed: [string, T][] } {
  const created: [string, T][] = [];
  const changed: [string, T][] = [];
  for (const [k, v] of after) {
    const b = before.get(k);
    if (b === undefined) created.push([k, v]);
    else if (b !== JSON.stringify(v)) changed.push([k, v]);
  }
  return { created, changed };
}

export class CommandOutOfOrder extends Error {}

/**
 * Cast one command against the event. Idempotent on cmd_id: a command already in the CommandLog returns its stored
 * result without running again (the webhook route's dedupe on event.id rides on this, D-13/D-23).
 */
export function castCommand(orgId: string, eventId: string, given: Command, opts: CastOptions = {}): Promise<Result> {
  return withOrg({ orgId }, async (tx) => {
    const pools = await tx.pool.findMany({ where: { eventId }, select: { poolId: true }, orderBy: { poolId: 'asc' } });
    for (const p of pools) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${eventId}:${p.poolId}`}))`;

    const seen = await tx.commandLog.findUnique({ where: { eventId_cmdId: { eventId, cmdId: given.cmd_id } } });
    if (seen) return { cmd_id: seen.cmdId, at: seen.at as Timestamp, kind: seen.kind, customer: seen.customer, status: seen.status, code: seen.code, detail: seen.detail };
    const lastRow = await tx.commandLog.findFirst({ where: { eventId }, orderBy: [{ at: 'desc' }, { cmdId: 'desc' }], select: { at: true, cmdId: true } });
    const last = lastRow && { at: lastRow.at as Timestamp, cmdId: lastRow.cmdId };
    const rows = await loadRows(tx, eventId);
    const cmd = opts.clock ? { ...given, at: stampAfter(eventNow(opts.clock, rows.event), given.cmd_id, last) } : given;
    if (last && compareStrings(cmd.at, last.at) < 0) throw new CommandOutOfOrder(`${cmd.cmd_id} at ${cmd.at} is before the log's last command ${last.cmdId} at ${last.at}`);
    const e = new Engine(eventDef(rows.event)).hydrate(engineState(rows, last?.at ?? null));
    const before = {
      holds: snap(e.holds), payments: snap(e.payments), orders: snap(e.orders), tickets: snap(e.tickets),
      seats: snap([...e.seats.values()].map((s) => [s.seat_id, [s.state, s.hold_id, s.ticket_id]] as [string, unknown])),
      entries: snap(e.waitlist.map((w) => [w.entry_id, w])), refunds: snap(e.refunds.map((r) => [r.refund_id, r])), cancelledAt: e.cancelledAt,
    };
    const res = e.apply(cmd);

    const base = { orgId, eventId };
    await tx.commandLog.create({ data: { ...base, cmdId: cmd.cmd_id, at: cmd.at, kind: cmd.kind, customer: cmd.customer, payload: cmd as object, status: res.status, code: res.code, detail: res.detail, stripeEventId: opts.stripeEventId ?? null } });
    await tx.$executeRaw`SELECT set_config('turnstile.cmd_id', ${cmd.cmd_id}, true)`;

    const d = {
      holds: delta(before.holds, e.holds), payments: delta(before.payments, e.payments), orders: delta(before.orders, e.orders), tickets: delta(before.tickets, e.tickets),
      seats: delta(before.seats, [...e.seats.values()].map((s) => [s.seat_id, [s.state, s.hold_id, s.ticket_id]] as [string, [typeof s.state, string | null, string | null]])),
      entries: delta(before.entries, e.waitlist.map((w) => [w.entry_id, w])), refunds: delta(before.refunds, e.refunds.map((r) => [r.refund_id, r])),
    };
    if (d.holds.created.length) await tx.hold.createMany({ data: d.holds.created.map(([holdId, h]) => ({ ...base, holdId, ...holdRow(h) })) });
    for (const [holdId, h] of d.holds.changed) await tx.hold.update({ where: { eventId_holdId: { eventId, holdId } }, data: holdRow(h) });
    if (d.payments.created.length) await tx.payment.createMany({ data: d.payments.created.map(([paymentId, p]) => ({ ...base, paymentId, ...paymentRow(p) })) });
    for (const [paymentId, p] of d.payments.changed) await tx.payment.update({ where: { eventId_paymentId: { eventId, paymentId } }, data: paymentRow(p) });
    if (d.orders.created.length) await tx.order.createMany({ data: d.orders.created.map(([orderId, o]) => ({ ...base, orderId, ...orderRow(o) })) });
    if (d.tickets.created.length) await tx.ticket.createMany({ data: d.tickets.created.map(([ticketId, t]) => ({ ...base, ticketId, ...ticketRow(t) })) });
    for (const [ticketId, t] of d.tickets.changed) await tx.ticket.update({ where: { eventId_ticketId: { eventId, ticketId } }, data: ticketRow(t) });
    for (const [seatId, [state, holdId, ticketId]] of d.seats.changed) await tx.seat.update({ where: { eventId_seatId: { eventId, seatId } }, data: { state, holdId, ticketId } });
    if (d.entries.created.length) await tx.waitlistEntry.createMany({ data: d.entries.created.map(([entryId, w]) => ({ ...base, entryId, ...entryRow(w) })) });
    for (const [entryId, w] of d.entries.changed) await tx.waitlistEntry.update({ where: { eventId_entryId: { eventId, entryId } }, data: entryRow(w) });
    if (d.refunds.created.length) await tx.refund.createMany({ data: d.refunds.created.map(([refundId, r]) => ({ ...base, refundId, ...refundRow(r) })) });
    if (e.cancelledAt !== before.cancelledAt) await tx.event.update({ where: { id: eventId }, data: { cancelledAt: e.cancelledAt } });
    return res;
  });
}
