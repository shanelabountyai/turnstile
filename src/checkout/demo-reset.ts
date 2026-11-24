// D-60: the nightly reset of the shared demo.
//
// `resetDemo` is called from the clone's cron (src/app/cron-jobs.ts), which Vercel hits once a day. It does anything
// at all only when the caller says demo mode is on (DEMO_MODE=1). Then, in this order:
//   1. it refuses unless every event in the database belongs to one of the two demo orgs and both orgs exist;
//   2. it refuses while any Refund row is still unconfirmed by Stripe: that row is the only record that money is owed
//      back, and the retry job (refund-retry.ts) runs just before this in the same cron;
//   3. it cancels every open PaymentIntent (a Payment still PENDING) through the gateway, and refuses to go on unless
//      every one was cancelled: a PaymentIntent left open could be paid after its event row is gone, and the webhook
//      for it would then be acknowledged as "ignored" with nobody refunded;
//   4. in ONE transaction it locks the Payment and Refund tables, checks 2 and 3 again under the lock, TRUNCATEs the
//      Turnstile tables and re-loads the fixture event into both demo orgs with the event clock at sales open. If any
//      part of that fails the transaction rolls back and the demo is as it was.
//
// THE EXCEPTION TO D-21. CommandLog, Order and Refund are append-only: row triggers refuse UPDATE and DELETE. TRUNCATE
// is not a row operation and the triggers do not see it. D-60 allows exactly this, here, in demo mode, on the tables
// listed in TURNSTILE_TABLES and no others. Outside demo mode nothing in this file runs and D-21 is unchanged.
//
// What it does not do: it does not touch the template's tables (accounts, orgs, sessions, the audit log, the outbox),
// it does not run the template's account seed (the demo accounts are not deleted, so there is nothing to re-seed), and
// it cannot cancel a PaymentIntent the database has no row for (payStart creates the PaymentIntent just before the
// cast that records it). It needs the app's database role to own the tables, as the deployed demo's does (RLS off,
// D-6); under RLS enforce the app role cannot TRUNCATE and the job fails without changing anything.
import { db } from '@/core/db';
import { log } from '@/core/log';
import { DEMO_ORGS } from './demo';
import { clockToSalesOpen } from './demo-seed';
import { loadFixtureInto } from './load';
import type { StripeGateway } from './stripe';

/** Every model of prisma/schema/turnstile.prisma, and nothing else (a test holds this list to the schema file). */
export const TURNSTILE_TABLES = ['Event', 'Pool', 'Tier', 'Section', 'Seat', 'Hold', 'Payment', 'Order', 'Ticket', 'WaitlistEntry', 'Refund', 'CommandLog', 'Customer'] as const;

/**
 * Where the fixture event is read from at runtime: `fixtures/` under the working directory, as every other loader here
 * reads it. next.config.ts names the two files the load needs (event.json, customers.csv) so they are in the cron
 * function's bundle. It is a plain relative name on purpose: built with path.join(process.cwd(), …) the build's file
 * tracer bundled the whole directory, answer key and expected_* files included, which product code must not carry
 * (non-negotiable 9). Checked in the build's route trace; not checked on Vercel.
 */
export const FIXTURE_DIR = 'fixtures';

/** Counts and a reason only: this is the cron's HTTP answer and its log line. PaymentIntent ids go to the error log. */
export type ResetResult =
  | { ran: true; cancelled: number; orgs: string[] }
  | { ran: false; why: 'DEMO_MODE is not 1' | 'an event exists outside the demo orgs' | 'the demo state changed while it was being reset' }
  | { ran: false; why: 'refunds not confirmed by Stripe'; unsettled: number }
  | { ran: false; why: 'open PaymentIntents could not be cancelled'; open: number; cancelled: number };

class Changed extends Error {}

export async function resetDemo(o: { demoMode: boolean; gateway: () => StripeGateway; wall?: Date; dir?: string }): Promise<ResetResult> {
  if (!o.demoMode) return { ran: false, why: 'DEMO_MODE is not 1' }; // before anything is read, built or called

  const orgs = await db.org.findMany({ where: { slug: { in: [...DEMO_ORGS] } }, select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
  const strangers = await db.event.count({ where: { orgId: { notIn: orgs.map((x) => x.id) } } });
  if (orgs.length !== DEMO_ORGS.length || strangers > 0) return { ran: false, why: 'an event exists outside the demo orgs' };

  const unsettled = await db.refund.count({ where: { stripeRefundId: null } });
  if (unsettled > 0) return { ran: false, why: 'refunds not confirmed by Stripe', unsettled };

  const open = await db.payment.findMany({ where: { state: 'PENDING' }, select: { eventId: true, paymentId: true }, orderBy: [{ eventId: 'asc' }, { paymentId: 'asc' }] });
  const cancelled = new Set<string>();
  let stripe: StripeGateway | null = null;
  for (const p of open) {
    try {
      stripe ??= o.gateway();
      await stripe.cancelPaymentIntent({ eventId: p.eventId, paymentIntentId: p.paymentId });
      cancelled.add(`${p.eventId}:${p.paymentId}`);
    } catch (e) {
      // the id and the error's class only (D-59); a gateway that cannot be built (no key on Production) lands here too
      console.error(`[turnstile] demo reset: could not cancel ${p.paymentId} (event ${p.eventId}): ${e instanceof Error ? e.constructor.name : 'error'}`);
    }
  }
  if (cancelled.size !== open.length) return { ran: false, why: 'open PaymentIntents could not be cancelled', open: open.length, cancelled: cancelled.size };

  const wall = o.wall ?? new Date();
  const dir = o.dir ?? FIXTURE_DIR;
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "Payment", "Refund" IN ACCESS EXCLUSIVE MODE');
      // under the lock nothing can start a payment or issue a refund: the two checks above must still hold
      const nowOpen = await tx.payment.findMany({ where: { state: 'PENDING' }, select: { eventId: true, paymentId: true } });
      if (nowOpen.some((p) => !cancelled.has(`${p.eventId}:${p.paymentId}`)) || (await tx.refund.count({ where: { stripeRefundId: null } })) > 0) throw new Changed();
      await tx.$executeRawUnsafe(`TRUNCATE ${TURNSTILE_TABLES.map((t) => `"${t}"`).join(', ')}`); // no CASCADE: nothing outside the list may go with it
      for (const org of orgs) await clockToSalesOpen(tx, (await loadFixtureInto(tx, org.id, dir)).eventId, wall);
    }, { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    if (e instanceof Changed) return { ran: false, why: 'the demo state changed while it was being reset' };
    throw e; // rolled back: the demo is as it was; the cron's fence reports the failure
  }
  log('demo.reset', { cancelled: cancelled.size, orgs: orgs.length });
  return { ran: true, cancelled: cancelled.size, orgs: orgs.map((x) => x.slug) };
}
