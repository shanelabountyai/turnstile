import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { dollars, eventByKey, readEvent } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { LinkButton, PageHeader, Pill, Section, Stat, Stats } from '@/components/ui';

// Task 3.7: the ledger. Captured, refunded and net come from the engine's summary; one line per captured payment
// (late money has no order), and the CSV is the same lines. No arithmetic here: every number is the read model's.

const when = (t: string) => t.replace('T', ' ');

export default async function Ledger({ params }: { params: Promise<{ org: string; event: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  const base = `/o/${ctx.slug}/events/${ev.eventKey}`;

  return (
    <main>
      <PageHeader
        eyebrow={v.event.name}
        title="Ledger"
        status={<Pill k="info">Event clock {when(v.asOf)}</Pill>}
        lead="Stripe test mode, synthetic customers. Integer cents throughout; the CSV has the same lines as the table."
        actions={<LinkButton href={`${base}/ledger/csv`} variant="secondary">Download CSV</LinkButton>}
      />

      <Stats>
        <Stat label="Captured" value={<span data-testid="captured">{dollars(v.ledger.capturedCents)}</span>} sub={`${v.payments.length} payments`} />
        <Stat label="Refunded" value={<span data-testid="refunded">{dollars(v.ledger.refundedCents)}</span>} sub={`${v.ledger.refunds} refunds`} />
        <Stat label="Net" value={<span data-testid="net">{dollars(v.ledger.netCents)}</span>} />
      </Stats>

      <Section id="payments" title="Payments">
        {v.payments.length === 0 ? <p>No payments captured yet.</p> : (
          <table>
            <caption>One line per captured payment</caption>
            <thead><tr><th scope="col">Payment</th><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Tier</th><th scope="col">Qty</th><th scope="col">Captured</th><th scope="col">Refunded</th><th scope="col">Net</th></tr></thead>
            <tbody>
              {v.payments.map((x) => (
                <tr key={x.payment} data-testid={`pay-${x.payment}`}>
                  <td>{x.payment}</td>
                  <td>{x.order ?? <Pill k="risk">{x.late === 'PAID_AFTER_CANCEL' ? 'paid after cancel' : 'paid after timeout'}</Pill>}</td>
                  <td>{x.customer}</td><td>{x.tier}</td><td>{x.qty}</td>
                  <td>{dollars(x.capturedCents)}</td><td>{dollars(x.refundedCents)}</td><td>{dollars(x.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </main>
  );
}
