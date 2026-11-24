// D-47: the deployed demo's seed, run by the Production build. Accounts plus a write-once fixture event per demo org;
// a second run (the next deploy) changes nothing; the event clock is moved only on a fresh load, to the moment sales
// open, whatever the wall date (D-60 item 2).
import { beforeAll, describe, expect, it } from 'vitest';
import { eventNow } from '@/checkout/clock';
import { dbSystem as db } from '@/core/db/system'; // fixtures run as the owner role
import { DEMO_ORGS, seedHosted } from '../../scripts/seed-hosted';
import { resetAuthTables } from '../helpers/auth';

const BEFORE_SALES = new Date('2026-11-20T18:00:00Z'); // 12:00 in the event's zone; sales open 2026-12-01T10:00:00
const DURING_SALES = new Date('2027-01-15T18:00:00Z');

const events = () => db.event.findMany({ orderBy: { org: { slug: 'asc' } }, select: { id: true, orgId: true, timezoneLabel: true, salesOpenAt: true, clockOffsetSeconds: true, org: { select: { slug: true } } } });

describe('seed-hosted (D-47)', () => {
  beforeAll(resetAuthTables);

  it('seeds the six demo accounts and loads the fixture event into both demo orgs, with the event clock at sales open', async () => {
    const lines = await seedHosted('fixtures', BEFORE_SALES);
    expect(await db.user.count({ where: { isDemo: true } })).toBe(6);
    const evs = await events();
    expect(evs.map((e) => e.org.slug)).toEqual([...DEMO_ORGS]);
    for (const e of evs) {
      expect(await db.seat.count({ where: { eventId: e.id, state: 'OPEN' } })).toBe(216);
      expect(await db.customer.count({ where: { orgId: e.orgId } })).toBe(700);
      expect(eventNow(BEFORE_SALES, e)).toBe(e.salesOpenAt); // the Buy screen can sell on the first visit
      expect(e.clockOffsetSeconds).toBeGreaterThan(0);
    }
    expect(await db.commandLog.count()).toBe(0); // nothing is cast: both events start with nothing sold
    expect(lines.filter((l) => l.includes('set to the moment sales open'))).toHaveLength(2);
  });

  it('a second run (the next deploy) adds nothing and never moves a clock staff have set', async () => {
    const acme = (await events())[0]!;
    await db.event.update({ where: { id: acme.id }, data: { clockOffsetSeconds: 123 } });
    const counts = async () => [await db.user.count(), await db.org.count(), await db.event.count(), await db.seat.count(), await db.customer.count()];
    const before = await counts();
    const lines = await seedHosted('fixtures', BEFORE_SALES);
    expect(await counts()).toEqual(before);
    expect((await events())[0]!.clockOffsetSeconds).toBe(123);
    expect(lines.filter((l) => l.includes('already loaded'))).toHaveLength(2);
  });

  // D-60 item 2 changed this behaviour on purpose (it was: "the event stays on the wall clock", offset 0). A load after
  // sales open on the wall clock now also starts at sales open, so a reset after 2026-12-01 does not put the demo on the
  // real calendar (review CODE-8, CODE-9, CODE-10).
  it('loaded while sales are open on the wall clock, the event clock is still put at sales open', async () => {
    await resetAuthTables();
    await seedHosted('fixtures', DURING_SALES);
    for (const e of await events()) {
      expect(eventNow(DURING_SALES, e)).toBe(e.salesOpenAt);
      expect(e.clockOffsetSeconds).toBeLessThan(0);
    }
  });
});
