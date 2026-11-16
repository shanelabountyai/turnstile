// Task 2.3: the fixture event into an org, write-once.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { AlreadyLoaded, loadFixtureEvent } from '@/checkout/load';
import { resetAuthTables } from '../helpers/auth';
import { makeOrg } from '../helpers/org';

let orgId = '';
beforeAll(async () => {
  await resetAuthTables();
  orgId = (await makeOrg('load')).id;
});

describe('turnstile:load', () => {
  it('loads 2 pools, 4 tiers, 3 sections, 216 seats and 700 customers (capacity 1,016)', async () => {
    const r = await loadFixtureEvent(orgId);
    expect(r).toMatchObject({ pools: 2, tiers: 4, sections: 3, seats: 216, customers: 700 });
    expect(await db.seat.count({ where: { orgId, state: 'OPEN' } })).toBe(216);
    expect((await db.pool.aggregate({ where: { orgId }, _sum: { capacity: true } }))._sum.capacity).toBe(1016);
    expect(await db.customer.count({ where: { orgId } })).toBe(700);
  });
  it('refuses a second load of the same event in the same org', async () => {
    await expect(loadFixtureEvent(orgId)).rejects.toThrow(AlreadyLoaded);
    expect(await db.event.count({ where: { orgId } })).toBe(1);
  });
});
