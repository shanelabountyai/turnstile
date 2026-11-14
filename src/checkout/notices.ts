// Notices (task 3.8, D-33): an order confirmation per new order and an offer notice per new waitlist offer, queued in
// the cast transaction so they commit with the command. Nothing is sent: rows go in with attempts = MAX_ATTEMPTS, so
// the template-owned drain (`attempts < MAX_ATTEMPTS`) never selects them. Templates are registered here, at runtime,
// into the foundation's exported record; src/modules/notifications/** is drift-guarded and not edited.
import { randomUUID } from 'node:crypto';
import type { Tx } from '@/core/db/rls';
import { MAX_ATTEMPTS } from '@/modules/notifications/outbox';
import { render, templates } from '@/modules/notifications/templates';
import type { Hold, Order, WaitlistEntry } from '@/inventory/types';
import { dollars } from './read';

export const HELD_NOTE = 'Not sent: Turnstile notices stop in the outbox (D-33).';

templates['turnstile.order_confirmed'] = (d) => ({
  subject: `Your tickets: order ${d.order_id}`,
  body: `${d.name}, order ${d.order_id} is confirmed: ${d.qty} × ${d.tier}${d.seats ? ` (seats ${d.seats})` : ''}, ${d.total} charged. Ticket ids: ${d.tickets}.`,
});
templates['turnstile.offer'] = (d) => ({
  subject: `Tickets are waiting for you: ${d.target}`,
  body: `${d.name}, you are at the head of the ${d.target} waitlist. ${d.qty} ticket(s) are held for you until ${d.expires_at} (event time). Pay before then or the offer passes to the next person.`,
});

/** Queue the notices for orders created and offers made by one command. A customer with no stored email gets none. */
export async function queueNotices(tx: Tx, orgId: string, orders: Order[], offers: [WaitlistEntry, Hold | undefined][]): Promise<number> {
  if (!orders.length && !offers.length) return 0;
  const ids = [...new Set([...orders.map((o) => o.customer), ...offers.map(([w]) => w.customer)])];
  const people = new Map((await tx.customer.findMany({ where: { orgId, customerId: { in: ids } } })).map((c) => [c.customerId, c]));
  const rows = [
    ...orders.map((o) => ({ customer: o.customer, template: 'turnstile.order_confirmed', data: {
      order_id: o.order_id, tier: o.tier, qty: String(o.qty), seats: o.seats.join(' '), total: dollars(o.gross_cents + o.fees_cents), tickets: o.tickets.join(' ') } })),
    ...offers.map(([w, h]) => ({ customer: w.customer, template: 'turnstile.offer', data: {
      entry_id: w.entry_id, offer_id: w.offer_id ?? '', target: w.target, qty: String(w.qty), expires_at: h?.expires_at ?? '' } })),
  ].flatMap(({ customer, template, data }) => {
    const c = people.get(customer);
    if (!c?.email) return [];
    const full = { ...data, name: c.name || customer };
    render(template, full); // a bad template fails the cast, not a drain nobody runs
    return [{ id: randomUUID(), orgId, channel: 'email', to: c.email, template, data: full, attempts: MAX_ATTEMPTS, lastError: HELD_NOTE }];
  });
  if (rows.length) await tx.outbox.createMany({ data: rows });
  return rows.length;
}
