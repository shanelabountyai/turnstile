import { notFound } from 'next/navigation';
import { axisNow, eventNow } from '@/checkout/clock';
import { dollars, eventByKey, percent, readEvent, type EventView } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { LinkButton, PageHeader, Pill, Section, Stat, Stats } from '@/components/ui';
import { setEventClock } from './actions';

// Task 3.3: the event as of now (D-31 read model, D-34 server clock). Every number is the read model's; this page
// formats and words them, nothing more. SOLD_OUT_POOL and SOLD_OUT_TIER read differently on purpose (non-negotiable 2).
type TierView = EventView['tiers'][number];

const SOLD_OUT: Record<NonNullable<TierView['soldOut']>, { short: string; why: string }> = {
  SOLD_OUT_POOL: { short: 'pool sold out', why: 'The shared pool is full. This tier still has allotment, but nothing is left in the pool to sell from.' },
  SOLD_OUT_TIER: { short: 'tier sold out', why: 'This tier has used its allotment. The shared pool may still have room for other tiers.' },
};

const when = (t: string) => t.replace('T', ' ');

export default async function EventScreen({ params }: { params: Promise<{ org: string; event: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const wall = new Date();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(wall, ev));
  const pool = new Map(v.pools.map((x) => [x.pool, x]));
  const r = v.event.rules;

  return (
    <main>
      <PageHeader
        eyebrow={v.event.venue}
        title={v.event.name}
        status={v.event.cancelledAt ? <Pill k="risk">Cancelled {when(v.event.cancelledAt)}</Pill> : <Pill k="info">Doors {when(v.event.doorsAt)} · starts {when(v.event.startsAt)}</Pill>}
        lead={<>As of {when(v.asOf)} ({v.event.timezoneLabel}). Sales {when(v.event.salesOpenAt)} to {when(v.event.salesCloseAt)}.</>}
        actions={<><LinkButton href={`/o/${ctx.slug}/events/${ev.eventKey}/buy`}>Buy</LinkButton> <LinkButton href={`/o/${ctx.slug}/events/${ev.eventKey}/box`} variant="secondary">Box office</LinkButton></>}
      />

      <Section id="clock" title="Event clock">
        <p className="hint">
          Every command and screen reads this clock, which runs at wall-clock speed from where staff set it (D-35). The server decides each expiry at the
          inclusive second; it can only move forward past the log{v.logAt && <> (last command {when(v.logAt)})</>}.
        </p>
        <p>Wall clock {when(axisNow(wall, ev.timezoneLabel))} · event clock <strong data-testid="event-clock">{when(v.asOf)}</strong></p>
        <ActionForm action={setEventClock.bind(null, ctx.slug)}>
          <input type="hidden" name="event" value={ev.eventKey} />
          <div className="cluster">
            <label>Set the event clock to <input name="to" type="datetime-local" step={1} defaultValue={v.asOf} required /></label>
            <button type="submit">Set clock</button>
          </div>
        </ActionForm>
        <ActionForm action={setEventClock.bind(null, ctx.slug)}>
          <input type="hidden" name="event" value={ev.eventKey} />
          <input type="hidden" name="reset" value="1" />
          <button type="submit" className="button" data-variant="secondary">Back to the wall clock</button>
        </ActionForm>
      </Section>

      <Section id="pools" title="Pools">
        <p className="hint">A pool is the room itself. Tiers sell from it, and their allotments add up to more than it holds, so the pool runs out first.</p>
        <Stats>
          {v.pools.map((x) => (
            <Stat key={x.pool} label={`${x.pool} · ${x.kind}`} value={x.remaining} k={x.remaining > 0 ? 'good' : 'risk'}
              sub={`remaining of ${x.capacity} · ${x.sold} sold · ${x.held} held · ${x.refunded} refunded`} />
          ))}
        </Stats>
      </Section>

      <Section id="tiers" title="Tiers">
        <Stats>
          {v.tiers.map((t) => {
            const pl = pool.get(t.pool)!;
            const formula = `available = min(tier remaining ${t.remaining}, pool remaining ${t.poolRemaining}) = ${t.available}. ` +
              `Tier ${t.tier}: allotment ${t.allotment}, ${t.sold} sold, ${t.held} held, ${t.refunded} refunded. ` +
              `Pool ${pl.pool}: capacity ${pl.capacity}, ${pl.sold} sold, ${pl.held} held.`;
            return (
              <div key={t.tier} className="stack">
                <Stat label={`${t.tier} · ${dollars(t.priceCents)}`} value={t.available} k={t.soldOut ? 'risk' : 'good'}
                  sub={<span title={formula} data-testid={`tier-${t.tier}`}>{t.remaining} remaining · {t.available} available{t.soldOut && <> — {SOLD_OUT[t.soldOut].short}</>}</span>} />
                <p className="cluster">
                  <Pill k={t.onSale ? 'info' : 'done'}>{t.onSale ? 'On sale' : 'Off sale'}</Pill>
                  <span className="muted">{when(t.onSaleAt)} to {when(t.offSaleAt)}</span>
                </p>
                {t.soldOut && <p className="hint">{SOLD_OUT[t.soldOut].why}</p>}
                <details><summary>How is {t.available} worked out?</summary><p className="hint">{formula}</p></details>
              </div>
            );
          })}
        </Stats>
      </Section>

      <Section id="rules" title="Rules" aside={<span className="muted">Read-only</span>}>
        <dl className="grid">
          <dt>Cart hold</dt><dd>{r.hold_ttl_minutes} min</dd>
          <dt>Payment timeout</dt><dd>{r.payment_timeout_minutes} min (a paying hold is not expired by the cart hold)</dd>
          <dt>Waitlist offer</dt><dd>{r.offer_ttl_minutes} min; an ignored offer is dropped ({r.offer_expired_rule})</dd>
          <dt>Waitlist order</dt><dd>{r.waitlist_rule === 'HEAD_BLOCKS' ? 'First in line is served first; nobody is skipped' : r.waitlist_rule}</dd>
          <dt>Tickets per order</dt><dd>up to {r.max_tickets_per_order}</dd>
          <dt>Service fee</dt><dd>{dollars(r.service_fee_cents)} per ticket</dd>
          <dt>Orphan seats</dt><dd>{r.prevent_orphan_seats ? 'Prevented: a hold may not leave a single open seat between taken ones' : 'Allowed'}</dd>
          <dt>If cancelled</dt><dd>{percent(r.cancellation_refund_bps)} refunded</dd>
        </dl>
        <table>
          <caption>Refund windows</caption>
          <thead><tr><th scope="col">Requested at least</th><th scope="col">Refund</th><th scope="col">Service fee</th></tr></thead>
          <tbody>
            {r.refund_policy.map((row) => (
              <tr key={row.min_days_before}><td>{row.min_days_before} days before</td><td>{percent(row.refund_bps)}</td><td>{row.fee_refunded ? 'refunded' : 'kept'}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>
    </main>
  );
}
