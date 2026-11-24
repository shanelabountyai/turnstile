import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { otherDemoOrg, usedUp } from '@/checkout/demo';
import { stripePublishableKey } from '@/checkout/env';
import { axis, day, duration, minutesFrom, refundWindows, saleState, stamp, tierState, time } from '@/checkout/format';
import { dollars, eventByKey, readEvent } from '@/checkout/read';
import { payForms } from '@/checkout/pay-form';
import { PAY_FORM_UNAVAILABLE, PAY_RECEIVED, PAY_RECEIVED_NEXT, usedUpWords } from '@/checkout/prd3-wording';
import { stripeGateway } from '@/checkout/stripe';
import { codeKind, sayCode } from '@/checkout/words';
import { demoEnabled } from '@/core/auth/demo';
import { requireOrg } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import { env } from '@/core/env';
import { ActionForm } from '@/core/ui/action-form';
import { Countdown } from '@/components/countdown';
import { StripePay } from '@/components/stripe-pay';
import { Announce } from '@/components/announce';
import { EmptyState, EventTabs, Notice, PageHeader, Pill, ScrollTable, Section } from '@/components/ui';
import { holdTickets, joinWaitlist, leaveWaitlist, payHold, releaseHold } from './actions';

// Task 3.4, design pass (D-37, artboards docs/design/Main.dc.html and BuyPhone.dc.html): buy as a chosen fixture
// customer (D-32), on the event clock (D-35). Every number is the read model's (D-31); every button casts one command
// and the result is read back from the CommandLog by cmd_id, so a rejected command shows its code, in words first.
// Countdowns are display-only; the server decides expiry (D-34). The artboard's "seats together" auto-pick is not built:
// seats are picked one by one and the engine judges the pick (D-38).

// The code the engine gives a command against a hold that has ended this way (requireHeld); other states read as themselves.
const ENDED: Record<string, string> = { EXPIRED: 'HOLD_EXPIRED', RELEASED: 'HOLD_RELEASED' };
// The same states in words for the pill (design pass, review: word first, code after).
const ENDED_WORDS: Record<string, string> = {
  EXPIRED: 'Expired', RELEASED: 'Released', PAY_TIMEOUT: 'Payment timed out', PAY_FAILED: 'Payment failed', CANCELLED: 'Cancelled',
  OFFER_EXPIRED: 'Offer expired', OFFER_DECLINED: 'Offer declined',
};
const LATE: Record<string, { why: string; reason: string }> = {
  PAID_AFTER_TIMEOUT: { why: 'so the hold had already ended and the tickets went back on sale', reason: 'Paid after the hold ended' },
  PAID_AFTER_CANCEL: { why: 'and the event had been cancelled in the meantime', reason: 'Paid after the event was cancelled' },
};

export const metadata = { title: 'Buy tickets · Turnstile' };

export default async function BuyScreen({ params, searchParams }: { params: Promise<{ org: string; event: string }>; searchParams: Promise<{ as?: string; r?: string; section?: string; payment_intent?: string; redirect_status?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const q = await searchParams;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  const { customers, result } = await withOrg(ctx, async (tx) => ({
    customers: await tx.customer.findMany({ where: { orgId: ctx.orgId }, orderBy: { customerId: 'asc' }, select: { customerId: true, name: true } }),
    result: q.r ? await tx.commandLog.findUnique({ where: { eventId_cmdId: { eventId: ev.id, cmdId: q.r } }, select: { kind: true, status: true, code: true, detail: true, at: true } }) : null,
  }), { atomic: false });
  const me = customers.find((c) => c.customerId === q.as);
  const slug = ctx.slug;
  const base = `/o/${slug}/events/${ev.eventKey}`;
  const self = `${base}/buy${me ? `?as=${me.customerId}` : ''}`;
  const pk = stripePublishableKey();
  const rules = v.event.rules;

  const holds = me ? v.holds.filter((h) => h.customer === me.customerId) : [];
  const live = holds.filter((h) => h.state === 'HELD' || h.state === 'PAYING');
  const ended = holds.filter((h) => h.state !== 'HELD' && h.state !== 'PAYING' && h.state !== 'CONFIRMED');
  const orders = me ? v.orders.filter((o) => o.customer === me.customerId) : [];
  const late = me ? v.payments.filter((x) => x.customer === me.customerId && x.late) : [];
  const lists = me ? v.waitlists.map((w) => ({ target: w.target, waiting: w.waiting.filter((x) => x.customer === me.customerId), offered: w.offered.filter((x) => x.customer === me.customerId) })).filter((w) => w.waiting.length || w.offered.length) : [];
  const ga = v.tiers.filter((t) => v.pools.find((x) => x.pool === t.pool)?.kind === 'GA');
  const tierOfPool = new Map(v.tiers.map((t) => [t.pool, t]));
  const poolOf = new Map(v.pools.map((x) => [x.pool, x]));
  const section = v.sections.find((s) => s.section === q.section) ?? v.sections[0];
  const balc = section && tierOfPool.get(section.pool);
  // One PAYING hold at a time (PRD-3 item 11): a Stripe failure for one PaymentIntent costs that hold its form, not the page.
  // Stripe's redirect back after confirmPayment carries the PaymentIntent and its status: that hold shows "Payment received", no form (item 10).
  const forms = await payForms(live, Boolean(pk), stripeGateway, { paymentIntent: q.payment_intent, redirectStatus: q.redirect_status });
  const hidden = me && <><input type="hidden" name="event" value={ev.eventKey} /><input type="hidden" name="customer" value={me.customerId} /></>;
  const said = result && sayCode(result.code);
  const sales = saleState(v);

  // Where the customer is, for the step list: the latest thing that happened to them, read off the view.
  const step = live.some((h) => h.kind === 'OFFER' && h.state === 'HELD') ? 'offer'
    : live.length > 0 ? 'pay'
      : lists.some((w) => w.waiting.length > 0) ? 'wait'
        : orders.length > 0 ? 'tickets' : 'pick';
  const STEPS: [string, string][] = [
    ['pick', 'Pick tickets or seats'],
    ['wait', 'Wait on the waitlist, if nothing fits'],
    ['offer', `Accept the offer (${duration(rules.offer_ttl_minutes)})`],
    ['pay', `Pay while held (${duration(rules.hold_ttl_minutes)}; the payment then has ${duration(rules.payment_timeout_minutes)})`],
    ['tickets', 'Tickets'],
  ];

  const picker = (
        <Section id="as" title="Acting as" aside={<span className="muted">Staff only (D-32)</span>}>
            <form method="get" className="cluster">
              <label>Customer{' '}
                <select name="as" defaultValue={q.as ?? ''} required>
                  <option value="" disabled>Pick one</option>
                  {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.customerId} · {c.name}</option>)}
                </select>
              </label>
              <button type="submit" className="secondary">Act as</button>
            </form>
            <p className="hint">Staff act as a synthetic customer; there is no public sign-up. Times are the event clock ({v.event.timezoneLabel}); <Link href={`${base}#clock`}>change it on the event page</Link>.</p>
          </Section>
  );

  return (
    <>
      <EventTabs base={base} current="buy" />
      <main id="main">
        <PageHeader
          eyebrow={`${v.event.name} · ${day(v.event.startsAt)} · doors ${time(v.event.doorsAt)}`}
          title={me ? <>Buy tickets · acting as {me.customerId}</> : 'Buy tickets'}
          status={<Pill k="info">Event clock {axis(v.asOf)}</Pill>}
          lead="Every count below is worked out from sold and held tickets when the page loads. Nothing is reserved until you have a hold."
        />

        {result && (
          <>
            <Notice k={codeKind(result.status, result.code)} title={said ?? `${result.kind} → ${result.code}`}>
              <span className="muted" data-testid="result">{result.status} {result.code}{result.detail && ` · ${result.detail}`} · at {axis(result.at)}</span>
            </Notice>
            <Announce assertive={result.status !== 'OK'} text={said ?? `${result.kind}: ${result.code}`} />
          </>
        )}

        {/* PRD-3 item 9: in demo mode a spent org says what to do next, above the customer picker wherever the picker is */}
        {usedUp(demoEnabled(), { asOf: v.asOf, ...v.event }) && <p className="limit" data-testid="used-up">{usedUpWords(otherDemoOrg(slug))}</p>}

        {!me && picker}

        {!me && <EmptyState>Pick a customer above to see what they can buy.</EmptyState>}

        {me && hidden && (
          <div className="split">
            <div className="col">
              {sales[1] !== 'On sale' && (
                <Notice k={sales[0]} title={sales[1]}>
                  Sales run {stamp(v.event.salesOpenAt)} to {stamp(v.event.salesCloseAt)}. A hold or a waitlist join now is refused by the engine and the refusal is shown here.
                </Notice>
              )}
              {late.map((x) => (
                <Notice key={x.payment} k="done" title="Payment received. No tickets issued. Full refund.">
                  <div className="stack" data-testid={`late-${x.payment}`}>
                    <p>
                      Your bank confirmed the payment {x.endedAt && <>{minutesFrom(x.startedAt, x.endedAt)} minutes </>}after checkout started. We hold tickets for {duration(rules.payment_timeout_minutes)} while
                      a payment clears, {(LATE[x.late!] ?? LATE.PAID_AFTER_TIMEOUT!).why}. You were never charged for tickets you didn&rsquo;t get: the whole amount is refunded.
                    </p>
                    <h2>Refund receipt</h2>
                    <dl className="receipt">
                      <dt>You tried to buy</dt><dd>{x.qty} × {x.tier}</dd>
                      <dt>Paid</dt><dd>{dollars(x.capturedCents)}</dd>
                      <dt>Refunded</dt><dd>{dollars(x.refundedCents)}, fees included</dd>
                      <dt>Reason</dt><dd>{(LATE[x.late!] ?? LATE.PAID_AFTER_TIMEOUT!).reason} ({x.late})</dd>
                      {x.refundedAt && <><dt>Refunded on</dt><dd>{stamp(x.refundedAt)}</dd></>}
                      <dt>Payment</dt><dd><code>{x.payment}</code></dd>
                    </dl>
                    <p className="hint">Test mode: the refund is recorded against the Stripe test PaymentIntent. Keep the payment reference if you contact the box office.</p>
                    <p><a className="button" href="#ga">See what&rsquo;s on sale now</a></p>
                  </div>
                </Notice>
              ))}

              {(live.length > 0 || ended.length > 0) && (
                <Section id="holds" title="Your holds">
                  <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
                    {live.map((h) => {
                      const what = h.seats.length ? h.seats.join(', ') : `${h.qty} × ${h.tier}`;
                      const sum = <>{h.qty} × ({dollars(h.priceCents)} + {dollars(h.feeCents)} fee) = <strong>{dollars(h.amountCents)}</strong></>;
                      return (
                        <li key={h.hold} data-testid={`hold-${h.hold}`} className="notice" data-k="hold" style={{ margin: 0 }}>
                          <strong>{h.kind === 'OFFER' ? `Waitlist offer: ${what}` : h.state === 'PAYING' ? `Paying: ${what}` : `Held for you: ${what}`}</strong>
                          <p className="cluster"><Pill k="hold">{h.state}</Pill><span>{h.kind === 'OFFER' ? 'Offer' : 'Hold'} {h.hold} · {h.tier}</span></p>
                          {h.kind === 'OFFER' && h.state === 'HELD' && <p>A seat came back and you were first in line. It is held for you until the timer runs out, then it goes to the next person.</p>}
                          {h.secondsLeft !== null && (
                            <p><span className="fig-lg"><Countdown key={h.deadline} seconds={h.secondsLeft} label={`time left on ${h.hold}`} /></span>{' '}
                              <span className="muted">{h.state === 'HELD' ? (h.kind === 'OFFER' ? 'to accept' : 'to pay') : 'for the payment to land'} · until {axis(h.deadline!)}</span></p>
                          )}
                          <p>{sum}</p>
                          {h.state === 'HELD' && (
                            <>
                              <p className="hint">If your bank takes longer than {duration(rules.payment_timeout_minutes)} to confirm, the hold ends and you get a full refund with the reason. You are never charged for seats you didn&rsquo;t get.</p>
                              <div className="cluster">
                                <ActionForm action={payHold.bind(null, slug)}>{hidden}<input type="hidden" name="hold" value={h.hold} /><button type="submit">{h.kind === 'OFFER' ? 'Accept and pay' : 'Pay'} {dollars(h.amountCents)}</button></ActionForm>
                                <ActionForm action={releaseHold.bind(null, slug)}>{hidden}<input type="hidden" name="hold" value={h.hold} /><button type="submit" className="ghost">{h.kind === 'OFFER' ? 'Decline the offer' : 'Release'}</button></ActionForm>
                              </div>
                            </>
                          )}
                          {h.state === 'PAYING' && (() => {
                            const f = forms.get(h.hold);
                            if (f?.kind === 'card') return <StripePay publishableKey={pk!} clientSecret={f.clientSecret} returnUrl={`${env.APP_URL}${self}`} />;
                            if (f?.kind === 'received') return <p role="status" data-testid="pay-received"><strong>{PAY_RECEIVED}</strong> {PAY_RECEIVED_NEXT} <span className="muted">PaymentIntent {h.paymentId}.</span></p>;
                            if (f?.kind === 'unavailable') return <p role="alert" data-testid="pay-unavailable">{PAY_FORM_UNAVAILABLE} <span className="muted">PaymentIntent {h.paymentId}.</span></p>;
                            return <p className="hint" data-testid="paying">PaymentIntent {h.paymentId}. {f?.kind === 'closed' ? 'Stripe is not taking a card for this payment now (it was paid, refused or cancelled).' : 'Recorded Stripe (no publishable key here): the tickets are issued when the signed webhook arrives.'} Refresh to see it land.</p>;
                          })()}
                        </li>
                      );
                    })}
                    {ended.map((h) => (
                      <li key={h.hold} data-testid={`hold-${h.hold}`} className="cluster">
                        <Pill k="done">{ENDED_WORDS[h.state] ?? h.state}</Pill>
                        <code className="muted">{ENDED[h.state] ?? h.state}</code>
                        <span>{h.kind === 'OFFER' ? 'Offer' : 'Hold'} {h.hold}</span>
                        <span className="muted">{h.tier} · {h.seats.length ? h.seats.join(' ') : h.qty}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {orders.length > 0 && (
                <Section id="orders" title="Your tickets">
                  <p className="hint">Show any ticket code at the door. Each code works once.</p>
                  {orders.map((o) => (
                    <div key={o.order} data-testid={`order-${o.order}`} className="stack">
                      <p className="cluster">
                        <Pill k={o.refundedCents > 0 ? 'done' : 'good'}>{o.refundedCents > 0 ? `Paid · ${dollars(o.refundedCents)} refunded` : 'Paid'}</Pill>
                        <span>{o.order}{o.viaOffer && ' (waitlist)'} · {o.qty} × {o.tier} · {dollars(o.paidCents)} paid, fees included</span>
                      </p>
                      <ul className="tickets">
                        {o.tickets.map((t, i) => (
                          <li key={t}><strong>{o.seats[i] || t}</strong>{o.seats[i] && <span className="muted"> · {t}</span>} · {o.states[i]}<br /><code>{o.codes[i]}</code></li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </Section>
              )}

              <Section id="ga" title="Floor · general admission">
                <ScrollTable label="Floor tiers">
                  <caption className="hint">What each tier can sell now</caption>
                  <thead><tr><th scope="col">Tier</th><th scope="col" className="num">{'Price + fee'}</th><th scope="col">Can you buy it?</th></tr></thead>
                  <tbody>
                    {ga.map((t) => {
                      const st = tierState(t, v.asOf);
                      return <tr key={t.tier}><td>{t.tier}</td><td className="num">{dollars(t.priceCents)} + {dollars(rules.service_fee_cents)}</td><td><Pill k={st.k}>{st.word}</Pill> <span className="muted">{st.line}</span></td></tr>;
                    })}
                  </tbody>
                </ScrollTable>
                {ga.filter((t) => t.onSale && t.soldOut === 'SOLD_OUT_POOL' && t.remaining > 0).map((t) => {
                  const pl = poolOf.get(t.pool)!;
                  return <p key={t.tier} className="limit">{t.tier} tickets still have {t.remaining} of their allotment, but the {pl.pool} pool holds {pl.capacity} and has none left ({pl.sold} sold, {pl.held} held). A tier can only sell what the pool has left.</p>;
                })}
                <ActionForm action={holdTickets.bind(null, slug)}>
                  {hidden}
                  <div className="cluster" style={{ alignItems: 'flex-end' }}>
                    <label>Tier{' '}
                      <select name="tier" required>
                        {ga.map((t) => <option key={t.tier} value={t.tier}>{t.tier} · {dollars(t.priceCents)} · {t.available} available{t.onSale ? '' : ' · off sale'}</option>)}
                      </select>
                    </label>
                    <label>Quantity <input name="qty" type="number" min={1} max={rules.max_tickets_per_order} defaultValue={1} required /></label>
                    <button type="submit">Hold tickets</button>
                  </div>
                </ActionForm>
                <p className="hint">A hold lasts {duration(rules.hold_ttl_minutes)}; once you pay, the payment has {duration(rules.payment_timeout_minutes)} to land.</p>
              </Section>

              {section && balc && (
                <Section id="seats" title={<>Balcony · reserved, {dollars(balc.priceCents)} + {dollars(rules.service_fee_cents)}</>}
                  aside={<span className="muted">{balc.remaining} remaining · {balc.available} available across sections {v.sections.map((s) => s.section).join(', ')}</span>}>
                  <nav aria-label="Balcony sections" className="tabs">
                    {v.sections.map((s) => (
                      <Link key={s.section} href={`${base}/buy?as=${me.customerId}&section=${s.section}#seats`} aria-current={s.section === section.section ? 'page' : undefined}>
                        Section {s.section} · {s.rows.flatMap((r) => r.seats).filter((st) => st.state === 'OPEN').length} open
                      </Link>
                    ))}
                  </nav>
                  <p className="hint">Rows read left to right. Legend: an outlined seat is open, a filled and struck-through seat is sold or held, a ✓ is your pick. A pick that would leave one open seat stranded between taken ones is refused (ORPHAN_SEAT) before checkout.</p>
                  <ActionForm action={holdTickets.bind(null, slug)}>
                    {hidden}
                    <input type="hidden" name="tier" value={balc.tier} />
                    <fieldset className="plain">
                      <legend className="sr-only">Section {section.section} seats</legend>
                      <ol className="seat-rows" aria-label={`Section ${section.section} rows`}>
                        {section.rows.map((r) => (
                          <li key={r.row}>
                            <span className="row-head"><span className="row-id">Row {r.row}</span><span className="muted">{r.seats.filter((st) => st.state === 'OPEN').length} open</span></span>
                            <span className="seats" role="group" aria-label={`Section ${section.section} row ${r.row}`}>
                              {r.seats.map((st) => (
                                <label key={st.seat} className="seat" data-k="hold" title={`${st.seat} ${st.state.toLowerCase()}`}>
                                  <input type="checkbox" name="seats[]" value={st.seat} disabled={st.state !== 'OPEN'} aria-label={`${st.seat} ${st.state.toLowerCase()}`} />
                                  {st.num}
                                </label>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ol>
                      <button type="submit">Hold seats in {section.section}</button>
                    </fieldset>
                  </ActionForm>
                  <ActionForm action={joinWaitlist.bind(null, slug)}>
                    {hidden}
                    <input type="hidden" name="target" value={section.section} />
                    <div className="cluster" style={{ alignItems: 'flex-end' }}>
                      <label>Seats together <input name="qty" type="number" min={1} max={rules.max_tickets_per_order} defaultValue={2} required /></label>
                      <button type="submit" className="secondary">Join the Section {section.section} waitlist</button>
                    </div>
                    <p className="hint">If no block of that size fits now, wait in line for Section {section.section}. You are offered seats together only when a block fits; nobody behind you is offered them first.</p>
                  </ActionForm>
                </Section>
              )}

              <Section id="waitlist" title="Waitlist">
                {lists.length > 0 && (
                  <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
                    {lists.map((w) => (
                      <li key={w.target} className="stack">
                        {w.waiting.map((x) => (
                          <div key={x.entry} data-testid={`entry-${x.entry}`} className="notice" data-k="info">
                            <strong>You&rsquo;re on the {w.target} waitlist for {x.qty} · position {x.position}{x.position === 1 && ' (next to be offered)'}</strong>
                            <span>When {x.qty} come back for {w.target}, the offer goes to the first person in line whose group fits. Nobody behind you is offered seats ahead of you. An offer stays open for {duration(rules.offer_ttl_minutes)}.</span>
                            <span className="hint">Entry {x.entry}. Offer notices stop in the outbox in this build; nothing is emailed.</span>
                            <ActionForm action={leaveWaitlist.bind(null, slug)}>{hidden}<input type="hidden" name="entry" value={x.entry} /><button type="submit" className="secondary">Leave the waitlist</button></ActionForm>
                          </div>
                        ))}
                        {w.offered.map((x) => <p key={x.entry} data-testid={`entry-${x.entry}`}>{x.entry} · {w.target}: offered as {x.offer} until {axis(x.expiresAt)}. Accept or decline it under Your holds.</p>)}
                      </li>
                    ))}
                  </ul>
                )}
                <ActionForm action={joinWaitlist.bind(null, slug)}>
                  {hidden}
                  <div className="cluster" style={{ alignItems: 'flex-end' }}>
                    <label>For{' '}
                      <select name="target" required>
                        {ga.map((t) => <option key={t.tier} value={t.tier}>tier {t.tier}</option>)}
                        {v.sections.map((s) => <option key={s.section} value={s.section}>section {s.section}</option>)}
                      </select>
                    </label>
                    <label>Quantity <input name="qty" type="number" min={1} max={rules.max_tickets_per_order} defaultValue={1} required /></label>
                    <button type="submit">Join waitlist</button>
                  </div>
                </ActionForm>
                <p className="hint">You can join only when what you want cannot be bought now. First in line is offered first and nobody is skipped; an ignored offer is dropped and the next in line is offered.</p>
              </Section>
            </div>

            <aside className="card side" aria-labelledby="where-h">
              <h2 id="where-h">Where you are</h2>
              <ol className="steps">
                {STEPS.map(([k, word]) => <li key={k} aria-current={k === step ? 'step' : undefined}>{word}</li>)}
              </ol>
              <div className="receipt stack" style={{ gap: 'var(--s-1)' }}>
                <strong>Refund policy</strong>
                {refundWindows(rules.refund_policy).map((line) => <span key={line}>{line}</span>)}
              </div>
              <p className="limit">Up to {rules.max_tickets_per_order} tickets per order.</p>
            </aside>
          </div>
        )}
        {me && picker}
      </main>
    </>
  );
}
