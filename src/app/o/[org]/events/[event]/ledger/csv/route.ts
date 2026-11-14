import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { eventByKey, ledgerCsv, readEvent } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';

export const dynamic = 'force-dynamic';

// Task 3.7: the ledger page's lines as CSV (core's RFC 4180 writer; no CSV library).
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; event: string }> }) {
  const ctx = await requireOrg((await params).org);
  const ev = await eventByKey(ctx.orgId, (await params).event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  return new Response(ledgerCsv(v), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${ctx.slug}-${ev.eventKey}-ledger.csv"`, 'Cache-Control': 'no-store' },
  });
}
