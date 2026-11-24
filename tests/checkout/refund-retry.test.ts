// PRD-3 item 12 (review CODE-3 retry part, CODE-12): the clone cron job that settles Refund rows Stripe has not
// confirmed (stripeRefundId NULL), and the count the Ledger shows.
//
// The safety rule under test: the job can never send a second refund for one Refund row. Stripe replays the first
// answer for an idempotency key for 24 hours; after that the same key is a new request, and if the first attempt had
// in fact succeeded at Stripe (and only the row update was lost) a retry would refund twice (#10 S3, D-59). So the job
// retries a row only while it can show the row is younger than RETRY_WINDOW_SECONDS (23 h, an hour inside Stripe's
// window), with the same key and the same parameters; any other row is left alone and counted as needing the owner.
// Stripe here is StripeRecorded (D-30). Stripe's own replay behaviour is not exercised: nothing reaches Stripe.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { castCommand } from '@/checkout/cast';
import { payStart } from '@/checkout/checkout';
import { loadFixtureEvent } from '@/checkout/load';
import { unsettledRefundsWords } from '@/checkout/prd3-wording';
import { pendingRefunds, RETRY_WINDOW_SECONDS, retryPendingRefunds } from '@/checkout/refund-retry';
import { idempotencyKey, StripeNotConfigured, StripeProviderError, StripeRecorded } from '@/checkout/stripe';
import { db } from '@/core/db';
import { timestamp } from '@/inventory/time';
import type { Command } from '@/inventory/types';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

const cmd = (c: Partial<Omit<Command, 'at'>> & { cmd_id: string; at: string; kind: string }): Command =>
  ({ customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...c, at: timestamp(c.at, 'at') });
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const HOUR = 3600;

type Ev = { orgId: string; eventId: string };
const evs: Ev[] = [];

/** One paid order of `qty` ADV tickets, then a refund of all of them that is cast but never sent to Stripe: `qty` pending rows. */
async function pendingIn(ev: Ev, n: number, qty: number): Promise<string[]> {
  const stripe = new StripeRecorded();
  const hh = String(10 + n).padStart(2, '0');
  const hold = `H-RR${n}`;
  expect((await castCommand(ev.orgId, ev.eventId, cmd({ cmd_id: `R${n}-1`, at: `2026-12-01T${hh}:00:00`, kind: 'HOLD', customer: 'C-0001', ref: hold, tier_id: 'ADV', qty }))).code).toBe('HELD');
  expect((await payStart(ev.orgId, ev.eventId, cmd({ cmd_id: `R${n}-2`, at: `2026-12-01T${hh}:01:00`, kind: 'PAY_START', customer: 'C-0001', ref: hold }), stripe)).code).toBe('PAYING');
  const paid = await castCommand(ev.orgId, ev.eventId, cmd({ cmd_id: `R${n}-3`, at: `2026-12-01T${hh}:02:00`, kind: 'PAY_SUCCEEDED', payment_id: `pi_rec_${hold}` }));
  expect(paid.code).toBe('CONFIRMED');
  const [order, ...tickets] = paid.detail.split(' ');
  const r = await castCommand(ev.orgId, ev.eventId, cmd({ cmd_id: `R${n}-4`, at: `2026-12-01T${hh}:03:00`, kind: 'REFUND_REQUEST', customer: 'C-0001', ref: order!, tickets }));
  expect(r.code).toBe('REFUNDED');
  return r.detail.split(' ').filter((w) => /^R-\d+$/.test(w));
}
const stripeIds = async (ev: Ev) => Object.fromEntries((await db.refund.findMany({ where: { eventId: ev.eventId }, orderBy: { refundId: 'asc' }, select: { refundId: true, stripeRefundId: true } })).map((r) => [r.refundId, r.stripeRefundId]));
const refundCalls = (s: StripeRecorded) => s.calls.filter((c) => c.kind === 'refund');

beforeAll(async () => {
  await resetAuthTables();
  const dir = mkdtempSync(join(tmpdir(), 'turnstile-retry-'));
  writeFileSync(join(dir, 'event.json'), readFileSync('fixtures/event.json', 'utf8'));
  writeFileSync(join(dir, 'customers.csv'), 'customer_id,name,email\nC-0001,One,one@example.test\n');
  for (const slug of ['retry-a', 'retry-b']) {
    const orgId = (await makeOrg(slug)).id;
    evs.push({ orgId, eventId: (await loadFixtureEvent(orgId, dir)).eventId });
  }
});

describe('the refund retry job (PRD-3 item 12)', () => {
  it('the window is 23 hours: one hour inside Stripe\'s 24-hour idempotency window', () => {
    expect(RETRY_WINDOW_SECONDS).toBe(23 * HOUR);
  });

  it('settles every pending Refund row it can show is inside the window, in every org, with the same idempotency key as the first attempt', async () => {
    const [a, b] = evs as [Ev, Ev];
    const inA = await pendingIn(a, 0, 2);
    const inB = await pendingIn(b, 0, 1);
    expect(await stripeIds(a)).toEqual({ 'R-00001': null, 'R-00002': null });
    // what the first attempt would have sent: the key is the event's UUID and the refund id, nothing else (D-56)
    const firstKeys = [...inA.map((r) => idempotencyKey(a.eventId, r)), ...inB.map((r) => idempotencyKey(b.eventId, r))];

    const stripe = new StripeRecorded();
    const out = await retryPendingRefunds(() => stripe);
    expect(out).toEqual({ unsettled: 3, retryable: 3, settled: 3, stillPending: 0, needsOwner: 0, failedEvents: 0 });
    expect(await stripeIds(a)).toEqual({ 'R-00001': 're_rec_R-00001', 'R-00002': 're_rec_R-00002' });
    expect(await stripeIds(b)).toEqual({ 'R-00001': 're_rec_R-00001' });
    expect(refundCalls(stripe).map((c) => idempotencyKey(c.eventId, c.refundId)).sort()).toEqual(firstKeys.sort());
    // same parameters as the row, which a trigger keeps immutable: a replayed key with other parameters would be Stripe's idempotency error
    expect(refundCalls(stripe).find((c) => c.eventId === b.eventId)).toEqual({ kind: 'refund', refundId: 'R-00001', paymentIntentId: 'pi_rec_H-RR0', amountCents: 3849, eventId: b.eventId });
  });

  it('a second run sends nothing: a settled row is never sent again', async () => {
    const stripe = new StripeRecorded();
    expect(await retryPendingRefunds(() => stripe)).toEqual({ unsettled: 0, retryable: 0, settled: 0, stillPending: 0, needsOwner: 0, failedEvents: 0 });
    expect(stripe.calls).toEqual([]);
  });

  it('just inside the window a row is retried; at the window\'s edge it is NOT, and is counted as needing the owner with no Stripe call', async () => {
    const a = evs[0]!;
    const [rid] = await pendingIn(a, 1, 1);
    const stripe = new StripeRecorded();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // at the edge (and a day later): outside what the job can show is safe
    for (const now of [later(RETRY_WINDOW_SECONDS + 5), later(48 * HOUR)]) {
      expect(await retryPendingRefunds(() => stripe, { now })).toEqual({ unsettled: 1, retryable: 0, settled: 0, stillPending: 0, needsOwner: 1, failedEvents: 0 });
    }
    expect(stripe.calls).toEqual([]);
    expect((await stripeIds(a))[rid!]).toBeNull();
    const said = errors.mock.calls.flat().join('\n');
    expect(said).toContain(rid!);
    expect(said).toContain('NOT retried');
    errors.mockRestore();
    expect(await pendingRefunds(a.orgId, a.eventId, later(RETRY_WINDOW_SECONDS + 5))).toMatchObject({ unsettled: 1, retryable: [], needsOwner: [{ refundId: rid }] });

    // just inside: retried once, settled
    expect(await retryPendingRefunds(() => stripe, { now: later(RETRY_WINDOW_SECONDS - 60) })).toEqual({ unsettled: 1, retryable: 1, settled: 1, stillPending: 0, needsOwner: 0, failedEvents: 0 });
    expect(refundCalls(stripe)).toHaveLength(1);
  });

  it('a row whose age cannot be shown (no command logged at its time) is never retried', async () => {
    const a = evs[0]!;
    // not something the cast path writes: a Refund row with no CommandLog row at its `at`
    await db.refund.create({ data: { orgId: a.orgId, eventId: a.eventId, refundId: 'R-90001', paymentId: 'pi_unknown', amountCents: 100, reason: 'TEST_NO_LOG', at: '2026-12-01T09:00:00' } });
    const stripe = new StripeRecorded();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await retryPendingRefunds(() => stripe)).toEqual({ unsettled: 1, retryable: 0, settled: 0, stillPending: 0, needsOwner: 1, failedEvents: 0 });
    expect(stripe.calls).toEqual([]);
    errors.mockRestore();
  });

  it('a clock that reads earlier than the row was logged is not trusted either', async () => {
    const stripe = new StripeRecorded();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = evs[1]!;
    await pendingIn(b, 1, 1);
    expect(await retryPendingRefunds(() => stripe, { now: later(-HOUR) })).toMatchObject({ retryable: 0, needsOwner: 2, failedEvents: 0 }); // b's new row and a's R-90001
    expect(stripe.calls).toEqual([]);
    errors.mockRestore();
  });

  it('Stripe failing again leaves the row pending and the job does not throw; so does having no gateway at all', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = new StripeRecorded();
    failing.failRefundOnce.add('R-00002'); // b's second refund, cast in the test above
    expect(await retryPendingRefunds(() => failing)).toEqual({ unsettled: 2, retryable: 1, settled: 0, stillPending: 1, needsOwner: 1, failedEvents: 0 });
    expect(await retryPendingRefunds(() => { throw new StripeNotConfigured(); })).toEqual({ unsettled: 2, retryable: 1, settled: 0, stillPending: 1, needsOwner: 1, failedEvents: 0 });
    expect((await stripeIds(evs[1]!))['R-00002']).toBeNull();
    // and the next run settles it, still with the one key
    const ok = new StripeRecorded();
    expect(await retryPendingRefunds(() => ok)).toMatchObject({ retryable: 1, settled: 1, stillPending: 0, needsOwner: 1, failedEvents: 0 });
    expect(refundCalls(ok)).toEqual([{ kind: 'refund', refundId: 'R-00002', paymentIntentId: 'pi_rec_H-RR1', amountCents: 3849, eventId: evs[1]!.eventId }]);
    errors.mockRestore();
  });

  it('an error that is not Stripe\'s in one event does not stop the other events, and is reported as a count, not thrown', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [a, b] = evs as [Ev, Ev];
    await pendingIn(a, 2, 1);
    await pendingIn(b, 2, 1);
    const stripe = new StripeRecorded();
    const boom = Object.assign(stripe, { createRefund: async (x: Parameters<StripeRecorded['createRefund']>[0]) => { if (x.eventId === a.eventId) throw new TypeError('not a Stripe error'); stripe.calls.push({ kind: 'refund', ...x }); return { id: `re_rec_${x.refundId}` }; } });
    const out = await retryPendingRefunds(() => boom);
    expect(out).toMatchObject({ retryable: 2, settled: 1, stillPending: 1, needsOwner: 1, failedEvents: 1 });
    expect(errors.mock.calls.flat().join('\n')).not.toContain('not a Stripe error'); // an error's text is not logged, only its class
    errors.mockRestore();
    expect(await retryPendingRefunds(() => new StripeRecorded())).toMatchObject({ settled: 1, stillPending: 0 });
  });
});

describe('cronJobs runs it (src/app/cron-jobs.ts)', () => {
  it('the job result is in the cron answer as counts only, and a fault in it does not fail the cron', async () => {
    const { cronJobs } = await import('@/app/cron-jobs');
    const jobs = await cronJobs();
    expect(jobs.refunds).toEqual({ unsettled: 1, retryable: 0, settled: 0, stillPending: 0, needsOwner: 1, failedEvents: 0 }); // R-90001: never retried
    expect(JSON.stringify(jobs.refunds)).not.toMatch(/R-9|pi_/); // counts, no ids, in the HTTP answer
  });
});

it('StripeProviderError is what a Stripe failure looks like to the job', () => {
  expect(new StripeNotConfigured()).toBeInstanceOf(StripeProviderError);
});

describe('the Ledger line (PRD-3 item 12)', () => {
  it('always gives the count; with any unsettled it says which are retried and which need the owner', () => {
    expect(unsettledRefundsWords(0, 0, 0)).toBe('Refunds not yet confirmed by Stripe: 0.');
    expect(unsettledRefundsWords(2, 2, 0)).toBe('Refunds not yet confirmed by Stripe: 2. They are already counted in Refunded above. 2 will be sent to Stripe again by the nightly job.');
    expect(unsettledRefundsWords(3, 1, 2)).toBe('Refunds not yet confirmed by Stripe: 3. They are already counted in Refunded above. 1 will be sent to Stripe again by the nightly job. 2 need the owner: too old to be retried safely (a retry could refund twice), so they are not retried automatically.');
    expect(unsettledRefundsWords(1, 0, 1)).toContain('1 needs the owner: too old to be retried safely (a retry could refund twice), so it is not retried automatically.');
  });
  it('the page\'s numbers come from pendingRefunds for that event only', async () => {
    const [a, b] = evs as [Ev, Ev];
    expect(await pendingRefunds(a.orgId, a.eventId)).toMatchObject({ unsettled: 1, retryable: [], needsOwner: [{ refundId: 'R-90001', eventId: a.eventId }] });
    expect(await pendingRefunds(b.orgId, b.eventId)).toEqual({ unsettled: 0, retryable: [], needsOwner: [] });
    expect(await pendingRefunds(a.orgId, b.eventId)).toEqual({ unsettled: 0, retryable: [], needsOwner: [] }); // another org's event is not visible through this org
  });
});
