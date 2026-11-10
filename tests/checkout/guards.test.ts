// Task 2.2 (D-21): every illegal UPDATE, DELETE and state transition is refused by the trigger, with its message;
// a legal transition goes through only with a CommandLog row of the same command in the same transaction.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { loadFixtureEvent } from '@/checkout/load';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

let orgId = '';
let eventId = '';
const AT = '2026-12-01T10:00:00';

beforeAll(async () => {
  await resetAuthTables();
  orgId = (await makeOrg('guards')).id;
  eventId = (await loadFixtureEvent(orgId)).eventId;
  const base = { orgId, eventId };
  await db.commandLog.create({ data: { ...base, cmdId: 'K-1', at: AT, kind: 'HOLD', payload: {}, status: 'OK', code: 'HELD' } });
  await db.hold.create({ data: { ...base, holdId: 'H-1', kind: 'HOLD', customer: 'C-0001', tierId: 'EARLY', qty: 1, createdAt: AT, expiresAt: '2026-12-01T10:10:00', priceCents: 2500, feeCents: 350 } });
  await db.payment.create({ data: { ...base, paymentId: 'P-1', holdId: 'H-1', amountCents: 2850, startedAt: AT } });
  await db.order.create({ data: { ...base, orderId: 'ORD-1', customer: 'C-0001', tierId: 'EARLY', qty: 1, grossCents: 2500, feesCents: 350, paymentId: 'P-1', confirmedAt: AT, tickets: ['T-1'], holdId: 'H-1', viaOffer: false } });
  await db.ticket.create({ data: { ...base, ticketId: 'T-1', orderId: 'ORD-1', tierId: 'EARLY', priceCents: 2500, feeCents: 350, issuedAt: AT, code: 'abc' } });
  await db.waitlistEntry.create({ data: { ...base, entryId: 'W-1', customer: 'C-0002', target: 'ADV', qty: 2, joinedAt: AT } });
  await db.refund.create({ data: { ...base, refundId: 'R-1', orderId: 'ORD-1', ticketId: 'T-1', paymentId: 'P-1', amountCents: 2850, reason: 'CUSTOMER_90_DAYS', at: AT } });
});

/** The same transition as the cast path makes it: CommandLog row first, the command id transaction-local, then the UPDATE. */
const asCommand = (cmdId: string, fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>) =>
  db.$transaction(async (tx) => {
    await tx.commandLog.create({ data: { orgId, eventId, cmdId, at: AT, kind: 'TEST', payload: {}, status: 'OK', code: 'X' } });
    await tx.$executeRaw`SELECT set_config('turnstile.cmd_id', ${cmdId}, true)`;
    return fn(tx);
  });

describe('append-only (D-21)', () => {
  it('CommandLog refuses UPDATE and DELETE', async () => {
    await expect(db.commandLog.update({ where: { eventId_cmdId: { eventId, cmdId: 'K-1' } }, data: { code: 'X' } })).rejects.toThrow('CommandLog is append-only (D-21)');
    await expect(db.commandLog.delete({ where: { eventId_cmdId: { eventId, cmdId: 'K-1' } } })).rejects.toThrow('CommandLog is append-only (D-21)');
  });
  it('Order refuses UPDATE and DELETE', async () => {
    await expect(db.order.update({ where: { eventId_orderId: { eventId, orderId: 'ORD-1' } }, data: { qty: 2 } })).rejects.toThrow('Order is append-only (D-21)');
    await expect(db.order.delete({ where: { eventId_orderId: { eventId, orderId: 'ORD-1' } } })).rejects.toThrow('Order is append-only (D-21)');
  });
  it('Refund refuses DELETE and any UPDATE except stripeRefundId NULL -> value, once', async () => {
    const where = { eventId_refundId: { eventId, refundId: 'R-1' } };
    await expect(db.refund.delete({ where })).rejects.toThrow('Refund is append-only (D-21)');
    await expect(db.refund.update({ where, data: { amountCents: 1 } })).rejects.toThrow('only stripeRefundId NULL -> value is written, once');
    await expect(db.refund.update({ where, data: { amountCents: 1, stripeRefundId: 're_1' } })).rejects.toThrow('only stripeRefundId NULL -> value is written, once');
    await db.refund.update({ where, data: { stripeRefundId: 're_1' } });
    await expect(db.refund.update({ where, data: { stripeRefundId: 're_2' } })).rejects.toThrow('only stripeRefundId NULL -> value is written, once');
  });
});

describe('transition guards (D-21)', () => {
  it('Hold: DELETE refused; HELD -> CONFIRMED is not a transition; HELD -> PAYING needs the CommandLog row; with it, it passes', async () => {
    const where = { eventId_holdId: { eventId, holdId: 'H-1' } };
    await expect(db.hold.delete({ where })).rejects.toThrow('Hold rows are never deleted (D-21)');
    await expect(db.hold.update({ where, data: { state: 'CONFIRMED' } })).rejects.toThrow('HELD -> CONFIRMED is not a transition (D-21)');
    await expect(db.hold.update({ where, data: { state: 'PAYING' } })).rejects.toThrow('HELD -> PAYING without a CommandLog row in this transaction (D-21)');
    // a CommandLog row from another transaction does not count: the setting is transaction-local
    await db.commandLog.create({ data: { orgId, eventId, cmdId: 'K-other', at: AT, kind: 'TEST', payload: {}, status: 'OK', code: 'X' } });
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('turnstile.cmd_id', ${'K-missing'}, true)`;
      await tx.hold.update({ where, data: { state: 'PAYING' } });
    })).rejects.toThrow('without a CommandLog row in this transaction');
    await asCommand('K-2', (tx) => tx.hold.update({ where, data: { state: 'PAYING', paymentId: 'P-1', payStartedAt: AT, payTimeoutAt: '2026-12-01T10:30:00' } }));
    expect((await db.hold.findUniqueOrThrow({ where })).state).toBe('PAYING');
    await expect(asCommand('K-3', (tx) => tx.hold.update({ where, data: { state: 'HELD' } }))).rejects.toThrow('PAYING -> HELD is not a transition (D-21)');
  });
  it('Payment: PENDING -> PENDING (a same-state write) and SUCCEEDED -> PENDING are refused; DELETE refused', async () => {
    const where = { eventId_paymentId: { eventId, paymentId: 'P-1' } };
    await expect(db.payment.delete({ where })).rejects.toThrow('Payment rows are never deleted (D-21)');
    await expect(asCommand('K-4', (tx) => tx.payment.update({ where, data: { amountCents: 1 } }))).rejects.toThrow('PENDING -> PENDING is not a transition (D-21)');
    await asCommand('K-5', (tx) => tx.payment.update({ where, data: { state: 'SUCCEEDED', endedAt: AT } }));
    await expect(asCommand('K-6', (tx) => tx.payment.update({ where, data: { state: 'PENDING' } }))).rejects.toThrow('SUCCEEDED -> PENDING is not a transition (D-21)');
  });
  it('Ticket: REFUNDED -> ISSUED refused; CHECKED_IN -> REFUNDED allowed; DELETE refused', async () => {
    const where = { eventId_ticketId: { eventId, ticketId: 'T-1' } };
    await expect(db.ticket.delete({ where })).rejects.toThrow('Ticket rows are never deleted (D-21)');
    await asCommand('K-7', (tx) => tx.ticket.update({ where, data: { state: 'CHECKED_IN', checkedInAt: AT } }));
    await expect(asCommand('K-8', (tx) => tx.ticket.update({ where, data: { state: 'ISSUED' } }))).rejects.toThrow('CHECKED_IN -> ISSUED is not a transition (D-21)');
    await asCommand('K-9', (tx) => tx.ticket.update({ where, data: { state: 'REFUNDED', refundedCents: 2850, refundedAt: AT } }));
    await expect(asCommand('K-10', (tx) => tx.ticket.update({ where, data: { state: 'ISSUED' } }))).rejects.toThrow('REFUNDED -> ISSUED is not a transition (D-21)');
  });
  it('Seat: OPEN -> SOLD refused (a seat is held first); OPEN -> HELD -> SOLD -> OPEN allowed; DELETE refused', async () => {
    const where = { eventId_seatId: { eventId, seatId: 'A-A-01' } };
    await expect(db.seat.delete({ where })).rejects.toThrow('Seat rows are never deleted (D-21)');
    await expect(asCommand('K-11', (tx) => tx.seat.update({ where, data: { state: 'SOLD' } }))).rejects.toThrow('OPEN -> SOLD is not a transition (D-21)');
    await asCommand('K-12', (tx) => tx.seat.update({ where, data: { state: 'HELD', holdId: 'H-1' } }));
    await asCommand('K-13', (tx) => tx.seat.update({ where, data: { state: 'SOLD', holdId: null, ticketId: 'T-1' } }));
    await asCommand('K-14', (tx) => tx.seat.update({ where, data: { state: 'OPEN', ticketId: null } }));
  });
  it('WaitlistEntry: WAITING -> FULFILLED refused; FULFILLED is terminal; DELETE refused', async () => {
    const where = { eventId_entryId: { eventId, entryId: 'W-1' } };
    await expect(db.waitlistEntry.delete({ where })).rejects.toThrow('WaitlistEntry rows are never deleted (D-21)');
    await expect(asCommand('K-15', (tx) => tx.waitlistEntry.update({ where, data: { state: 'FULFILLED' } }))).rejects.toThrow('WAITING -> FULFILLED is not a transition (D-21)');
    await asCommand('K-16', (tx) => tx.waitlistEntry.update({ where, data: { state: 'OFFERED', offerId: 'O-1', offeredAt: AT } }));
    await asCommand('K-17', (tx) => tx.waitlistEntry.update({ where, data: { state: 'FULFILLED', orderId: 'ORD-1', endedAt: AT } }));
    await expect(asCommand('K-18', (tx) => tx.waitlistEntry.update({ where, data: { state: 'WAITING' } }))).rejects.toThrow('FULFILLED -> WAITING is not a transition (D-21)');
  });
  it('the axis CHECK refuses a timestamp off the axis (D-9)', async () => {
    await expect(db.commandLog.create({ data: { orgId, eventId, cmdId: 'K-bad', at: '2026-12-01 10:00:00', kind: 'HOLD', payload: {}, status: 'OK', code: 'HELD' } })).rejects.toThrow(/CommandLog_at_axis/);
  });
});
