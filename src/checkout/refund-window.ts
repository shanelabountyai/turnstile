// Which unconfirmed refunds may be sent to Stripe again (PRD-3 item 12, D-70). The reasoning is in refund-retry.ts;
// this file holds the one query and the one comparison, so that every caller of settleRefunds uses the same rule:
// the nightly retry, a box-office refund, and a late-payment webhook.
import { withOrg } from '@/core/db/rls';

/** How old a pending refund may be shown to be and still be retried: 23 hours. Stripe's idempotency window is 24. */
export const RETRY_WINDOW_SECONDS = 23 * 60 * 60;

export type PendingRefund = { eventId: string; refundId: string; paymentId: string; amountCents: number };
export type Pending = { unsettled: number; retryable: PendingRefund[]; needsOwner: PendingRefund[] };

type Row = PendingRefund & { firstLogged: Date | null; dbNow: Date };

/**
 * The org's Refund rows Stripe has not confirmed, split by whether a retry can be shown to be safe (see the file
 * header of refund-retry.ts). `now` defaults to the database's clock. CommandLog.createdAt is stamped when the row is
 * written, by the database or by the app server; the hour between 23 and 24 is the margin for the two differing, and an
 * age that comes out negative is not trusted. A test passes its own `now`.
 */
export async function pendingRefunds(orgId: string, eventId?: string, now?: Date): Promise<Pending> {
  const rows = await withOrg({ orgId }, (tx) => tx.$queryRaw<Row[]>`
    SELECT r."eventId"::text AS "eventId", r."refundId", r."paymentId", r."amountCents",
           (SELECT min(c."createdAt") FROM "CommandLog" c WHERE c."eventId" = r."eventId" AND c."at" = r."at") AS "firstLogged",
           now() AS "dbNow"
      FROM "Refund" r
     WHERE r."orgId" = ${orgId}::uuid AND r."stripeRefundId" IS NULL
     ORDER BY r."eventId", r."refundId"`, { atomic: false });
  const mine = eventId ? rows.filter((r) => r.eventId === eventId) : rows;
  const out: Pending = { unsettled: mine.length, retryable: [], needsOwner: [] };
  for (const { firstLogged, dbNow, ...r } of mine) {
    const ageMs = firstLogged ? (now ?? dbNow).getTime() - firstLogged.getTime() : null;
    (ageMs !== null && ageMs >= 0 && ageMs < RETRY_WINDOW_SECONDS * 1000 ? out.retryable : out.needsOwner).push(r);
  }
  return out;
}
