'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { castCommand } from '@/checkout/cast';
import { eventNow } from '@/checkout/clock';
import { eventByKey } from '@/checkout/read';
import { orgAction } from '@/core/authz/action';
import { withOrg } from '@/core/db/rls';

// Task 3.6: the door scans a ticket code. The code is looked up to its ticket id (CHECK_IN takes the id, C-1); a code
// that matches nothing is cast as typed, so the engine itself answers TICKET_UNKNOWN and the refusal is in the log.
export const scanTicket = orgAction(null, z.object({ event: z.string().min(1).max(64), code: z.string().trim().min(1).max(64) }), async (ctx, i) => {
  const ev = await eventByKey(ctx.orgId, i.event);
  if (!ev) return { error: 'No such event in this organisation.' };
  const t = await withOrg(ctx, (tx) => tx.ticket.findFirst({ where: { eventId: ev.id, OR: [{ code: i.code }, { ticketId: i.code }] }, select: { ticketId: true } }), { atomic: false });
  const clock = new Date();
  const cmd_id = `U-${randomUUID()}`;
  await castCommand(ctx.orgId, ev.id, {
    cmd_id, at: eventNow(clock, ev), kind: 'CHECK_IN', customer: '', ref: t?.ticketId ?? i.code, tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: 'door',
  }, { clock });
  redirect(`/o/${ctx.slug}/events/${ev.eventKey}/door?r=${cmd_id}`);
});
