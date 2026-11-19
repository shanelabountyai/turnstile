import { notFound } from 'next/navigation';
import { axisNow, eventNow } from '@/checkout/clock';
import { axis, count, date, day, duration, refundWords, tierState, time } from '@/checkout/format';
import { dollars, eventByKey, percent, readEvent, type EventView } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { EventTabs, PageHeader, Pill, ScrollTable, Section } from '@/components/ui';
import { setEventClock } from './actions';

// Task 3.3, design pass (D-37, artboard docs/design/Event.dc.html): the event as of now (D-31 read model, D-34 server
// clock). Every number is the read model's; this page formats and words them, nothing more. SOLD_OUT_POOL and
// SOLD_OUT_TIER read differently on purpose (non-negotiable 2). The event clock is a staff control the artboard leaves
// out; it stays, at the foot of the page (D-38).
type TierView = EventView['tiers'][number];

const SOLD_OUT: Record<NonNullable<TierView['soldOut']>, { short: string; why: string }> = {
  SOLD_OUT_POOL: { short: 'pool sold out', why: 'The pool is the reason, not the tier: this tier still has allotment, but nothing is left in the pool to sell from.' },
  SOLD_OUT_TIER: { short: 'tier sold out', why: 'The tier is the reason: it has used its allotment. The shared pool may still have room for other tiers.' },
};

export const metadata = { title: 'Event · Turnstile' };

export default async function EventScreen({ params }: { params: Promise<{ org: string; event: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const wall = new Date();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(wall, ev));
  const pool = new Map(v.pools.map((x) => [x.pool, x]));
  const r = v.event.rules;
  const base = `/o/${ctx.slug}/events/${ev.eventKey}`;

  return (
    <>
      <EventTabs base={base} current="event" />
      <main id="main">
        <PageHeader
          eyebrow={`Event · ${v.event.venue}`}
          title={v.event.name}
          status={v.event.cancelledAt ? <Pill k="risk">Cancelled {axis(v.event.cancelledAt)}</Pill> : <Pill k="info">Event clock {axis(v.asOf)}</Pill>}
          lead={<>{day(v.event.startsAt)} · doors {time(v.event.doorsAt)} · starts {time(v.event.startsAt)} · {v.event.timezoneLabel}. Sales {date(v.event.salesOpenAt)} to {date(v.event.salesCloseAt)}.</>}
        />

        <p className="scope"><strong>How &ldquo;available&rdquo; is worked out:</strong> available = the smaller of what the tier has left and what its pool has left. Sold and held tickets count against both; a refunded ticket goes back to both. Nobody edits these numbers.</p>

        <h2 id="pools">Pools</h2>
        <p className="hint">A pool is the room itself. Tiers sell from it, and their allotments add up to more than it holds, so the pool runs out first.</p>
        <div className="grid pair">
          {v.pools.map((x) => (
            <article key={x.pool} className="card" aria-labelledby={`pool-${x.pool}`} data-testid={`pool-${x.pool}`}>
              <div className="cluster" style={{ justifyContent: 'space-between' }}>
                <h3 id={`pool-${x.pool}`}>{x.pool} · {x.kind === 'GA' ? 'general admission' : 'reserved'}</h3>
                {x.remaining > 0 ? <Pill k="good">Seats available</Pill> : <Pill k="risk">Pool sold out</Pill>}
              </div>
              <p><span className="fig-lg">{count(x.remaining)}</span> <span className="muted">left of {count(x.capacity)}</span></p>
              <p className="muted">{count(x.capacity)} capacity − {count(x.sold)} sold − {count(x.held)} held = {count(x.remaining)} left · {count(x.refunded)} refunded tickets returned to the pool along the way</p>
            </article>
          ))}
        </div>

        <h2 id="tiers">Tiers</h2>
        <div className="grid">
          {v.tiers.map((t) => {
            const pl = pool.get(t.pool)!;
            const { k, word } = tierState(t, v.asOf);
            const formula = `available = min(tier remaining ${t.remaining}, pool remaining ${t.poolRemaining}) = ${t.available}. ` +
              `Tier ${t.tier}: allotment ${t.allotment}, ${t.sold} sold, ${t.held} held, ${t.refunded} refunded. ` +
              `Pool ${pl.pool}: capacity ${pl.capacity}, ${pl.sold} sold, ${pl.held} held.`;
            return (
              <article key={t.tier} className="card" aria-labelledby={`tier-h-${t.tier}`}>
                <div className="cluster" style={{ justifyContent: 'space-between' }}>
                  <h3 id={`tier-h-${t.tier}`}>{t.tier} <span className="muted">{t.pool} · {dollars(t.priceCents)}</span></h3>
                  <Pill k={k}>{word}</Pill>
                </div>
                <dl className="figs">
                  <div><dt>Allotment</dt><dd>{count(t.allotment)}</dd></div>
                  <div><dt>Sold</dt><dd>{count(t.sold)}</dd></div>
                  <div><dt>Remaining</dt><dd>{count(t.remaining)}</dd></div>
                  <div><dt>Available</dt><dd>{count(t.available)}</dd></div>
                </dl>
                <p className="muted"><span title={formula} data-testid={`tier-${t.tier}`}>{t.remaining} remaining · {t.available} available{t.soldOut && <> — {SOLD_OUT[t.soldOut].short}</>}</span></p>
                <details>
                  <summary>Why {t.available} available</summary>
                  <p className="hint">{formula}{t.soldOut && <> {SOLD_OUT[t.soldOut].why}</>}{!t.onSale && <> It is off sale at this time, so it sells nothing now; its refunded tickets went back to the {t.pool} pool.</>}</p>
                </details>
                <p className="muted">On sale {axis(t.onSaleAt)} to {axis(t.offSaleAt)}</p>
              </article>
            );
          })}
        </div>

        <Section id="rules" title="Rules" aside={<span className="muted">Read-only · set in event.json</span>}>
          <dl>
            <dt>Cart hold</dt><dd>{duration(r.hold_ttl_minutes)}</dd>
            <dt>Payment must land within</dt><dd>{duration(r.payment_timeout_minutes)}, or the payment is refunded in full (a paying hold is not expired by the cart hold)</dd>
            <dt>Waitlist offer open for</dt><dd>{duration(r.offer_ttl_minutes)}; an unanswered offer is dropped ({r.offer_expired_rule})</dd>
            <dt>Waitlist order</dt><dd>{r.waitlist_rule === 'HEAD_BLOCKS' ? 'First in line is never skipped' : r.waitlist_rule}</dd>
            <dt>Single seats</dt><dd>{r.prevent_orphan_seats ? 'A hold may not leave one seat stranded between two taken ones (row ends excepted)' : 'Allowed'}</dd>
            <dt>Per order</dt><dd>Up to {r.max_tickets_per_order} tickets · {dollars(r.service_fee_cents)} service fee each</dd>
            <dt>If cancelled</dt><dd>{percent(r.cancellation_refund_bps)} refunded, fees included</dd>
          </dl>
          <ScrollTable label="Refund windows">
            <caption>Refund windows</caption>
            <thead><tr><th scope="col">Requested at least</th><th scope="col">Refund</th><th scope="col">Service fee</th><th scope="col">In words</th></tr></thead>
            <tbody>
              {r.refund_policy.map((row) => (
                <tr key={row.min_days_before}><td>{row.min_days_before} days before</td><td>{percent(row.refund_bps)}</td><td>{row.fee_refunded ? 'refunded' : 'kept'}</td><td>{refundWords(row.refund_bps, row.fee_refunded)}</td></tr>
              ))}
            </tbody>
          </ScrollTable>
        </Section>

        <Section id="clock" title="Event clock" aside={<span className="muted">Staff only</span>}>
          <p className="hint">
            Every command and screen reads this clock, which runs at wall-clock speed from where staff set it (D-35). The server decides each expiry at the
            inclusive second; it can only move forward past the log{v.logAt && <> (last command {axis(v.logAt)})</>}.
          </p>
          <p>Wall clock {axis(axisNow(wall, ev.timezoneLabel))} · event clock <strong data-testid="event-clock">{axis(v.asOf)}</strong></p>
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
            <button type="submit" className="secondary">Back to the wall clock</button>
          </ActionForm>
        </Section>
      </main>
    </>
  );
}
