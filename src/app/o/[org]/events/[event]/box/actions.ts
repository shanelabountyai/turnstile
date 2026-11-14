'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requestRefund } from '@/checkout/checkout';
import { eventNow } from '@/checkout/clock';
import { eventByKey } from '@/checkout/read';
import { stripeGateway } from '@/checkout/stripe';
import { orgAction } from '@/core/authz/action';
import { withOrg } from '@/core/db/rls';
import type { Command } from '@/inventory/types';

// Task 3.5: the box office's refund. Staff refund on the customer's behalf, so the command carries the order's
// customer (R-1 checks it). One REFUND_REQUEST through the cast path, then Stripe is told (D-23); the engine decides
// the amount, as it did in the preview.
const label = z.string().min(1).max(32);

export const confirmRefund = orgAction(null, z.object({ event: z.string().min(1).max(64), order: label, tickets: z.array(label).min(1).max(16) }), async (ctx, i) => {
  const ev = await eventByKey(ctx.orgId, i.event);
  if (!ev) return { error: 'No such event in this organisation.' };
  const order = await withOrg(ctx, (tx) => tx.order.findUnique({ where: { eventId_orderId: { eventId: ev.id, orderId: i.order } }, select: { customer: true } }), { atomic: false });
  if (!order) return { error: `No order ${i.order} for this event.` };
  const clock = new Date();
  const cmd: Command = {
    cmd_id: `U-${randomUUID()}`, at: eventNow(clock, ev), kind: 'REFUND_REQUEST', customer: order.customer, ref: i.order, tier_id: '', qty: 0, seats: [],
    payment_id: '', target: '', tickets: i.tickets, note: 'box office',
  };
  await requestRefund(ctx.orgId, ev.id, cmd, stripeGateway(), { clock });
  redirect(`/o/${ctx.slug}/events/${ev.eventKey}/box?order=${i.order}&r=${cmd.cmd_id}#refund`);
});
