// PRD-2 item 5 (D-65): a member's Set clock is refused in words, not by a throw. A thrown AuthzError replaced the whole
// org layout with the app's error page and an HTTP 500 (review UX-5, A11Y-1, CODE-4); a returned `{ error }` is what
// ActionForm shows inline. The guard is still requireOrg's `org.update` check (D-35): nothing about who may move the
// clock changes here, only how the refusal reaches the screen.
import { beforeAll, describe, expect, it } from 'vitest';
import { setEventClock } from '@/app/o/[org]/events/[event]/actions';
import { CLOCK_MOVERS } from '@/checkout/refusal';
import { loadFixtureEvent } from '@/checkout/load';
import { can } from '@/core/authz/permissions';
import { db } from '@/core/db';
import { resetAuthTables, signInAs } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';
import { NavSignal } from '../helpers/next';

const EVENT = 'EV-SYNTH-001';
const TO = '2027-03-20T19:00:05';
let org = { id: '', slug: '' };
let eventId = '';
const users: Record<'owner' | 'admin' | 'member' | 'scorekeeper' | 'stranger', string> = { owner: '', admin: '', member: '', scorekeeper: '', stranger: '' };

beforeAll(async () => {
  await resetAuthTables();
  org = await makeOrg('clock');
  eventId = (await loadFixtureEvent(org.id)).eventId;
  for (const role of ['owner', 'admin', 'member', 'scorekeeper'] as const) users[role] = (await addMember(org.id, role, `${role}@example.test`)).id;
  users.stranger = (await db.user.create({ data: { email: 'stranger@example.test' } })).id;
});

const offset = async () => (await db.event.findUniqueOrThrow({ where: { id: eventId }, select: { clockOffsetSeconds: true } })).clockOffsetSeconds;
const clockAudits = () => db.auditEvent.count({ where: { orgId: org.id, action: 'event.clock_set' } });
const outcome = async (input: Record<string, string>) => {
  try {
    return { returned: await setEventClock(org.slug, input) };
  } catch (e) {
    return { threw: e };
  }
};

describe('setEventClock refuses a role without org.update inline (PRD-2 item 5)', () => {
  it('the sentence names who can move the clock, and the action still declares org.update', () => {
    expect(CLOCK_MOVERS).toBe('Only the organisation’s owner or an admin can move the event clock.');
    expect(setEventClock.spec).toMatchObject({ kind: 'org', perm: 'org.update' });
    expect((['owner', 'admin', 'member', 'scorekeeper'] as const).filter((r) => can(r, 'org.update'))).toEqual(['owner', 'admin']);
  });

  for (const role of ['member', 'scorekeeper'] as const) {
    it(`a ${role} gets { error } back, not a throw, and nothing is written`, async () => {
      const before = { offset: await offset(), audits: await clockAudits() };
      await signInAs(users[role], { mfa: true });
      expect(await outcome({ event: EVENT, to: TO })).toEqual({ returned: { error: CLOCK_MOVERS } });
      expect(await outcome({ event: EVENT, reset: '1' })).toEqual({ returned: { error: CLOCK_MOVERS } });
      // The guard runs before the parse, as for every action: a refused role learns nothing about the form either.
      expect(await outcome({ event: EVENT, to: 'not a time' })).toEqual({ returned: { error: CLOCK_MOVERS } });
      expect({ offset: await offset(), audits: await clockAudits() }).toEqual(before);
    });
  }

  it('someone who is not a member still gets notFound, and an anonymous caller is still sent to sign in', async () => {
    const before = await offset();
    await signInAs(users.stranger, { mfa: true });
    const stranger = await outcome({ event: EVENT, to: TO });
    expect(stranger.threw).toBeInstanceOf(NavSignal);
    expect((stranger.threw as NavSignal).kind).toBe('notFound');
    const { jar } = await import('../helpers/next');
    jar.clear();
    const anon = await outcome({ event: EVENT, to: TO });
    expect(anon.threw).toBeInstanceOf(NavSignal);
    expect((anon.threw as NavSignal).to).toBe('/login');
    expect(await offset()).toBe(before);
  });

  it('an owner and an admin still move the clock: redirect back to the event, the offset stored, one audit line each', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const audits = await clockAudits();
      await signInAs(users[role], { mfa: true });
      const r = await outcome({ event: EVENT, to: role === 'owner' ? TO : '2027-03-20T19:30:00' });
      expect(r.threw).toBeInstanceOf(NavSignal);
      expect((r.threw as NavSignal).to).toBe(`/o/${org.slug}/events/${EVENT}`);
      expect(await offset()).toBeGreaterThan(0); // 2027-03-20 is ahead of any wall clock this test runs on before then
      expect(await clockAudits()).toBe(audits + 1);
    }
  });

  it('a domain refusal for an owner is unchanged: an unknown event is { error } with its own words', async () => {
    await signInAs(users.owner, { mfa: true });
    expect(await outcome({ event: 'EV-NOPE', to: TO })).toEqual({ returned: { error: 'No such event in this organisation.' } });
  });
});
