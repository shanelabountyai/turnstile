// PRD-3 item 9 (review UX-3, UX-4, UX-15; D-60 unblocked it): a spent demo org says what to do next, the clock move
// that closes sales asks first and says it is one-way, and "Back to the wall clock" is not offered in demo mode when
// it can only fail or would break the walk. The decisions are pure functions over axis timestamps (non-negotiable 8:
// strings compared as strings, no Date); the action's side is driven through setEventClock.
import { beforeAll, describe, expect, it } from 'vitest';
import { setEventClock } from '@/app/o/[org]/events/[event]/actions';
import { castCommand } from '@/checkout/cast';
import { crossesSalesClose, DEMO_ORGS, otherDemoOrg, usedUp, wallClockBlock } from '@/checkout/demo';
import { loadFixtureEvent } from '@/checkout/load';
import { CLOCK_PAST_CLOSE, usedUpWords, WALL_CLOCK_BLOCKED } from '@/checkout/prd3-wording';
import { db } from '@/core/db';
import { timestamp, type Timestamp } from '@/inventory/time';
import { resetAuthTables, signInAs } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';
import { NavSignal } from '../helpers/next';

const t = (s: string) => timestamp(s, 't');
const OPEN = t('2026-12-01T10:00:00');
const CLOSE = t('2027-03-20T20:00:00');
const ev = { salesOpenAt: OPEN, salesCloseAt: CLOSE, cancelledAt: null as Timestamp | null };

describe('usedUp: the line shows in demo mode once sales have closed on the event clock', () => {
  it('half-open: the closing second is already closed', () => {
    expect(usedUp(true, { ...ev, asOf: t('2027-03-20T19:59:59') })).toBe(false);
    expect(usedUp(true, { ...ev, asOf: CLOSE })).toBe(true);
    expect(usedUp(true, { ...ev, asOf: t('2027-03-21T09:00:00') })).toBe(true);
  });
  it('never outside demo mode, never before sales open, never for a cancelled event (that has its own notice)', () => {
    expect(usedUp(false, { ...ev, asOf: CLOSE })).toBe(false);
    expect(usedUp(true, { ...ev, asOf: t('2026-11-24T00:00:00') })).toBe(false);
    expect(usedUp(true, { ...ev, asOf: CLOSE, cancelledAt: t('2027-01-01T00:00:00') })).toBe(false);
  });
  it('names the other demo organisation', () => {
    expect(DEMO_ORGS).toEqual(['acme', 'globex']);
    expect(otherDemoOrg('acme')).toBe('globex');
    expect(otherDemoOrg('globex')).toBe('acme');
    expect(otherDemoOrg('some-other-org')).toBe('globex');
    expect(usedUpWords('globex')).toBe('This organisation’s demo is used up: sales have closed on its event clock, and the clock cannot go back. Use the other demo organisation, globex, or ask for a reset.');
  });
});

describe('crossesSalesClose: only the move that closes sales asks', () => {
  it('from before the close to the close or later', () => {
    expect(crossesSalesClose(t('2027-03-20T19:00:05'), CLOSE, CLOSE)).toBe(true);
    expect(crossesSalesClose(OPEN, t('2027-03-21T00:00:00'), CLOSE)).toBe(true);
  });
  it('not a move that stays before the close (the README\'s 19:00:05), and not one made after sales have already closed', () => {
    expect(crossesSalesClose(OPEN, t('2027-03-20T19:00:05'), CLOSE)).toBe(false);
    expect(crossesSalesClose(OPEN, t('2027-03-20T19:59:59'), CLOSE)).toBe(false);
    expect(crossesSalesClose(CLOSE, t('2027-03-21T00:00:00'), CLOSE)).toBe(false);
  });
});

describe('wallClockBlock: when "Back to the wall clock" is not offered in demo mode', () => {
  const base = { demo: true, offsetSeconds: 600, asOf: OPEN, logAt: null as Timestamp | null, ...ev };
  it('it can only fail: the wall clock is before the log\'s last command', () => {
    expect(wallClockBlock({ ...base, wall: t('2026-11-24T08:00:00'), asOf: t('2026-12-01T10:30:00'), logAt: t('2026-12-01T10:20:00') })).toBe('fails');
  });
  it('it would break the walk: the wall clock is before sales open and the event clock is inside the sales window', () => {
    expect(wallClockBlock({ ...base, wall: t('2026-11-24T08:00:00') })).toBe('before-open');
  });
  it('it would spend the org: the wall clock is at or past sales close and the event clock is not', () => {
    expect(wallClockBlock({ ...base, wall: t('2027-03-20T20:00:00') })).toBe('closes-sales');
  });
  it('offered when the wall clock is a usable time inside the sales window', () => {
    expect(wallClockBlock({ ...base, wall: t('2026-12-15T12:00:00') })).toBeNull();
  });
  it('offered when the event is already on the wall clock (the press changes nothing), and always outside demo mode', () => {
    expect(wallClockBlock({ ...base, offsetSeconds: 0, wall: t('2026-11-24T08:00:00'), asOf: t('2026-11-24T08:00:00') })).toBeNull();
    expect(wallClockBlock({ ...base, demo: false, wall: t('2026-11-24T08:00:00') })).toBeNull();
    expect(wallClockBlock({ ...base, demo: false, wall: t('2026-11-24T08:00:00'), logAt: t('2026-12-01T10:20:00') })).toBeNull(); // off demo the action still refuses it, in words, as before
  });
  it('every reason has a sentence', () => {
    expect(Object.keys(WALL_CLOCK_BLOCKED).sort()).toEqual(['before-open', 'closes-sales', 'fails']);
  });
});

describe('setEventClock asks before a move that closes sales (PRD-3 item 9)', () => {
  const EVENT = 'EV-SYNTH-001';
  let org = { id: '', slug: '' };
  let eventId = '';
  let owner = '';
  const offset = async () => (await db.event.findUniqueOrThrow({ where: { id: eventId }, select: { clockOffsetSeconds: true } })).clockOffsetSeconds;
  const audits = () => db.auditEvent.count({ where: { orgId: org.id, action: 'event.clock_set' } });
  const run = async (input: Record<string, string>) => {
    try {
      return { returned: await setEventClock(org.slug, input) };
    } catch (e) {
      return { nav: e instanceof NavSignal ? e.to : String(e) };
    }
  };

  beforeAll(async () => {
    await resetAuthTables();
    org = await makeOrg('oneway');
    eventId = (await loadFixtureEvent(org.id)).eventId;
    owner = (await addMember(org.id, 'owner', 'owner@example.test')).id;
  });

  it('without the confirmation nothing is written: the owner is sent to the confirmation on the Event page', async () => {
    await signInAs(owner, { mfa: true });
    const before = { offset: await offset(), audits: await audits() };
    expect(await run({ event: EVENT, to: '2027-03-20T20:00:00' })).toEqual({ nav: `/o/oneway/events/${EVENT}?confirm_clock=2027-03-20T20:00:00#clock` });
    expect(await run({ event: EVENT, to: '2027-03-21T09:00' })).toEqual({ nav: `/o/oneway/events/${EVENT}?confirm_clock=2027-03-21T09:00:00#clock` });
    expect({ offset: await offset(), audits: await audits() }).toEqual(before);
  });
  it('a move that stays before the close needs no confirmation (the README\'s step 7)', async () => {
    await signInAs(owner, { mfa: true });
    expect(await run({ event: EVENT, to: '2027-03-20T19:00:05' })).toEqual({ nav: `/o/oneway/events/${EVENT}` });
    expect(await offset()).toBeGreaterThan(0);
  });
  it('with the confirmation the clock moves and the move is audited', async () => {
    await signInAs(owner, { mfa: true });
    const n = await audits();
    expect(await run({ event: EVENT, to: '2027-03-20T20:00:00', confirm: '1' })).toEqual({ nav: `/o/oneway/events/${EVENT}` });
    expect(await audits()).toBe(n + 1);
  });
  it('once sales have closed, a later time needs no second confirmation', async () => {
    await signInAs(owner, { mfa: true });
    expect(await run({ event: EVENT, to: '2027-03-21T09:00:00' })).toEqual({ nav: `/o/oneway/events/${EVENT}` });
  });
  it('"Back to the wall clock" still answers in words when the log is ahead of the wall clock', async () => {
    await castCommand(org.id, eventId, { cmd_id: 'W-1', at: t('2027-03-21T09:30:00'), kind: 'CHECK_IN', customer: '', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: 'no such code' });
    await signInAs(owner, { mfa: true });
    const r = await run({ event: EVENT, reset: '1' });
    expect(r).toEqual({ returned: { error: expect.stringContaining('the event clock cannot go before it') } });
  });
  it('the warning says what closes, when, and that it cannot be undone', () => {
    const said = CLOCK_PAST_CLOSE.body('2027-03-20 20:00:00', '2027-03-21 09:00:00');
    expect(said).toContain('2027-03-20 20:00:00');
    expect(said).toContain('2027-03-21 09:00:00');
    expect(said).toMatch(/cannot be set back/);
  });
});
