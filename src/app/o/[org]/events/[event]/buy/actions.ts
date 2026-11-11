'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { castCommand } from '@/checkout/cast';
import { payStart } from '@/checkout/checkout';
import { eventNow } from '@/checkout/clock';
import { eventByKey } from '@/checkout/read';
import { stripeGateway } from '@/checkout/stripe';
import { orgAction } from '@/core/authz/action';
import type { OrgCtx } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import type { Command } from '@/inventory/types';

// Task 3.4: the Buy screen's commands. Staff act as a fixture customer (D-32). Each action casts exactly one command,
// stamped on the event clock inside the cast's lock (D-35), and shows its code: accepted or rejected, the screen reads
// the result back from the CommandLog by cmd_id. No rule is checked here; the engine decides.
const who = { event: z.string().min(1).max(64), customer: z.string().regex(/^C-\d{4,}$/, 'Pick a customer to act as.') };

async function cast(ctx: OrgCtx, i: { event: string; customer: string }, c: Partial<Command> & Pick<Command, 'kind'>) {
  const ev = await eventByKey(ctx.orgId, i.event);
  if (!ev) return { error: 'No such event in this organisation.' };
  const known = await withOrg(ctx, (tx) => tx.customer.findUnique({ where: { orgId_customerId: { orgId: ctx.orgId, customerId: i.customer } }, select: { customerId: true } }), { atomic: false });
  if (!known) return { error: `No customer ${i.customer} in this organisation.` };
  const clock = new Date();
  const cmd: Command = {
    cmd_id: `U-${randomUUID()}`, at: eventNow(clock, ev), customer: i.customer, ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: 'buy screen', ...c,
  };
  if (cmd.kind === 'PAY_START') await payStart(ctx.orgId, ev.id, cmd, stripeGateway(), { clock });
  else await castCommand(ctx.orgId, ev.id, cmd, { clock });
  redirect(`/o/${ctx.slug}/events/${ev.eventKey}/buy?as=${i.customer}&r=${cmd.cmd_id}`);
}

const qty = z.coerce.number().int().min(0).max(99);
const label = z.string().min(1).max(32);

/** HOLD: GA by quantity, reserved by seats. The hold id is minted here; the engine refuses a duplicate (HOLD_ID_DUPLICATE). */
export const holdTickets = orgAction(null, z.object({ ...who, tier: label, qty: qty.default(0), seats: z.array(label).max(16).default([]) }), (ctx, i) =>
  cast(ctx, i, { kind: 'HOLD', ref: `H-${randomUUID().slice(0, 8).toUpperCase()}`, tier_id: i.tier, qty: i.qty, seats: i.seats }));

export const releaseHold = orgAction(null, z.object({ ...who, hold: label }), (ctx, i) => cast(ctx, i, { kind: 'RELEASE', ref: i.hold }));

/** PAY_START: the PaymentIntent first (idempotency key = hold id), then the cast (D-23). Works the same for an offer. */
export const payHold = orgAction(null, z.object({ ...who, hold: label }), (ctx, i) => cast(ctx, i, { kind: 'PAY_START', ref: i.hold }));

export const joinWaitlist = orgAction(null, z.object({ ...who, target: label, qty }), (ctx, i) => cast(ctx, i, { kind: 'WAITLIST_JOIN', target: i.target, qty: i.qty }));

export const leaveWaitlist = orgAction(null, z.object({ ...who, entry: label }), (ctx, i) => cast(ctx, i, { kind: 'WAITLIST_LEAVE', ref: i.entry }));
