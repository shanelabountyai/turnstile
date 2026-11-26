// PRD-3 item 11: "payStart … compares the amount before the cast". The engine's previewed amount and the stored
// hold's cannot differ through any real path (the preview is hydrated from the same rows), so this file forces the
// disagreement by replacing the preview, and checks what the comparison then guarantees: nothing is sent to Stripe,
// nothing is cast, the hold stays HELD, and the Buy action answers in words.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { castCommand } from '@/checkout/cast';
import { PaymentAmountMismatch, PayStartError, payStart } from '@/checkout/checkout';
import { loadFixtureEvent } from '@/checkout/load';
import { PAY_AMOUNT_MISMATCH } from '@/checkout/prd3-wording';
import { StripeRecorded } from '@/checkout/stripe';
import { db } from '@/core/db';
import { timestamp } from '@/inventory/time';
import type { Command, Result } from '@/inventory/types';
import { resetAuthTables, signInAs } from '../helpers/auth';
import { pinEventClock } from '../helpers/clock';
import { addMember, makeOrg } from '../helpers/org';

const wrong = vi.hoisted(() => ({ on: false }));
vi.mock('@/checkout/read', async (orig) => {
  const real = await orig<typeof import('@/checkout/read')>();
  return {
    ...real,
    previewCommand: async (...a: Parameters<typeof real.previewCommand>): Promise<Result> => {
      const r = await real.previewCommand(...a);
      return wrong.on && r.code === 'PAYING' ? { ...r, detail: r.detail.replace(/ \d+$/, ' 1') } : r; // the engine "says" 1 cent
    },
  };
});
const recorded = vi.hoisted(() => ({ stripe: null as unknown }));
vi.mock('@/checkout/stripe', async (orig) => {
  const real = await orig<typeof import('@/checkout/stripe')>();
  return { ...real, stripeGateway: () => recorded.stripe ?? new real.StripeRecorded() };
});

let org = { id: '', slug: '' };
let eventId = '';
let member = '';
const cmd = (c: Partial<Omit<Command, 'at'>> & { cmd_id: string; at: string; kind: string }): Command =>
  ({ customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: '', ...c, at: timestamp(c.at, 'at') });

beforeAll(async () => {
  await resetAuthTables();
  org = await makeOrg('payamount');
  const dir = mkdtempSync(join(tmpdir(), 'turnstile-payamount-'));
  writeFileSync(join(dir, 'event.json'), readFileSync('fixtures/event.json', 'utf8'));
  writeFileSync(join(dir, 'customers.csv'), 'customer_id,name,email\nC-0001,One,one@example.test\n');
  eventId = (await loadFixtureEvent(org.id, dir)).eventId;
  // the Buy action stamps on the event clock; pinned before H-AMT (2026-12-01T10:00, 10 minutes), so it lands at the
  // log's end on any date
  await pinEventClock(eventId, '2026-11-01T00:00:00');
  member = (await addMember(org.id, 'member', 'member@example.test')).id;
  expect((await castCommand(org.id, eventId, cmd({ cmd_id: 'A-1', at: '2026-12-01T10:00:00', kind: 'HOLD', customer: 'C-0001', ref: 'H-AMT', tier_id: 'ADV', qty: 2 }))).code).toBe('HELD');
});

describe('the amount is compared before anything is sent or cast', () => {
  it('a disagreement throws PaymentAmountMismatch: no Stripe call, no command recorded, the hold still HELD', async () => {
    wrong.on = true;
    const stripe = new StripeRecorded();
    const err = await payStart(org.id, eventId, cmd({ cmd_id: 'A-2', at: '2026-12-01T10:01:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-AMT' }), stripe).catch((e: unknown) => e);
    wrong.on = false;
    expect(err).toBeInstanceOf(PaymentAmountMismatch);
    expect(err).toBeInstanceOf(PayStartError);
    expect((err as PayStartError).kind).toBe('amount');
    expect(stripe.calls).toEqual([]);
    expect(await db.commandLog.findUnique({ where: { eventId_cmdId: { eventId, cmdId: 'A-2' } } })).toBeNull();
    expect((await db.hold.findUniqueOrThrow({ where: { eventId_holdId: { eventId, holdId: 'H-AMT' } } })).state).toBe('HELD');
    expect(await db.payment.count({ where: { eventId } })).toBe(0);
  });

  it('the Buy action answers with the amount sentence, and Stripe is still not called', async () => {
    const { payHold } = await import('@/app/o/[org]/events/[event]/buy/actions');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stripe = new StripeRecorded();
    recorded.stripe = stripe;
    wrong.on = true;
    await signInAs(member, { mfa: true });
    expect(await payHold(org.slug, { event: 'EV-SYNTH-001', customer: 'C-0001', hold: 'H-AMT' })).toEqual({ error: PAY_AMOUNT_MISMATCH });
    wrong.on = false;
    recorded.stripe = null;
    expect(stripe.calls).toEqual([]);
    expect(errors.mock.calls.flat().join('\n')).toContain('H-AMT');
    errors.mockRestore();
  });

  it('with the real preview the same hold then pays for the engine\'s amount', async () => {
    const stripe = new StripeRecorded();
    expect((await payStart(org.id, eventId, cmd({ cmd_id: 'A-3', at: '2026-12-01T10:02:00', kind: 'PAY_START', customer: 'C-0001', ref: 'H-AMT' }), stripe)).detail).toBe('pi_rec_H-AMT 7698');
  });
});
