// turnstile:load (task 2.3): the fixture event, its seats and the customers into one org, write-once. Reads
// fixtures/event.json and customers.csv through the engine's own loaders; never answer_key.csv or expected_*.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withOrg } from '@/core/db/rls';
import { parseCsv } from '@/inventory/csv';
import { mintSeats } from '@/inventory/event';
import { loadEvent } from '@/inventory/load';

export class AlreadyLoaded extends Error {}

export async function loadFixtureEvent(orgId: string, dir = 'fixtures') {
  const ev = loadEvent(dir);
  const customers = parseCsv(readFileSync(join(dir, 'customers.csv'), 'utf8'), 'customers.csv');
  const { seats } = mintSeats(ev);
  return withOrg({ orgId }, async (tx) => {
    if (await tx.event.findUnique({ where: { orgId_eventKey: { orgId, eventKey: ev.event_id } } })) throw new AlreadyLoaded(`${ev.event_id} is already loaded in this org (write-once)`);
    const { id: eventId } = await tx.event.create({
      data: {
        orgId, eventKey: ev.event_id, name: ev.name, venue: ev.venue, timezoneLabel: ev.timezone_label,
        startsAt: ev.starts_at, doorsAt: ev.doors_at, salesOpenAt: ev.sales_open_at, salesCloseAt: ev.sales_close_at,
        currency: ev.currency, ticketSalt: ev.ticket_salt, rules: ev.rules,
      },
    });
    await tx.pool.createMany({ data: ev.pools.map((p) => ({ orgId, eventId, poolId: p.pool_id, kind: p.kind, capacity: p.capacity })) });
    await tx.tier.createMany({ data: ev.tiers.map((t) => ({ orgId, eventId, tierId: t.tier_id, poolId: t.pool_id, allotment: t.allotment, priceCents: t.price_cents, onSaleAt: t.on_sale_at, offSaleAt: t.off_sale_at })) });
    await tx.section.createMany({ data: ev.sections.map((s) => ({ orgId, eventId, sectionId: s.section_id, poolId: s.pool_id, rows: s.rows, seatsPerRow: s.seats_per_row })) });
    await tx.seat.createMany({ data: [...seats.values()].map((s) => ({ orgId, eventId, seatId: s.seat_id, section: s.section, row: s.row, num: s.num, tierId: s.tier, poolId: s.pool })) });
    await tx.customer.createMany({ data: customers.map((c) => ({ orgId, customerId: c.customer_id!, name: c.name ?? '', email: c.email ?? '' })), skipDuplicates: true });
    return { eventId, pools: ev.pools.length, tiers: ev.tiers.length, sections: ev.sections.length, seats: seats.size, customers: customers.length };
  });
}
