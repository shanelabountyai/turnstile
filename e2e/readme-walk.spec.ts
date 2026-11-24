import { expect, test, type Browser, type Page } from '@playwright/test';
import { axisNow } from '@/checkout/clock';
import { db } from '@/core/db';
import { timestamp, toSeconds } from '@/inventory/time';
import { DEMO_ORGS, seedHosted } from '../scripts/seed-hosted';
import { EVENT, paySucceeded } from './turnstile';

// PRD-2 item 6 (D-67): README.md "Try the live demo", walked by two visitors on ONE database, each line the README
// marks "You should see" asserted for both. The visitors are separate browser contexts (separate people), and the
// second is a different fresh customer, as the README tells every visitor to be.
//
// Why two tests. Step 7 is one-way: it moves the event clock to show night, and the org cannot sell the walk's tiers
// after it. So two COMPLETE walks cannot both happen in one org, whoever the customers are. What can happen:
//   A. the first visitor finishes (steps 1 to 7) in acme; the second finds acme spent and, as the README says, does
//      the whole walk in globex;
//   B. the first visitor stops after step 6 (no clock move); the second does the whole walk in the SAME org, with the
//      first visitor's holds, orders, sold seats and refund already there. This is the case review UX-2 is about.
//
// What stands in for Stripe: as in hosted-demo.spec, the server under test has no Stripe key, so Pay answers from
// StripeRecorded and the success webhook is posted signed with the published fixture secret. Step 3's card form and a
// real Stripe test payment are NOT exercised here (docs/EVAL.md O-8, the owner's hand step).
//
// The event clock: both events are put at the moment sales open, whatever the wall date, so the amounts the README
// quotes (more than 30 days before the show) hold when this runs after 2026-12-01 too.
const ORGS = { acme: 'Acme Studio', globex: 'Globex Labs' } as const;
type Org = keyof typeof ORGS;
type Visitor = { org: Org; floor: string; balcony: string; firstInOrg: boolean; clock: { type?: [date: string, time: string]; fill: string; shows: string } };
type Carried = { floorCodes: string[]; balconyCode: string };
const cents = (shown: string) => Number(shown.replace(/[$,.]/g, ''));

const ids: Record<Org, { orgId: string; eventId: string }> = { acme: { orgId: '', eventId: '' }, globex: { orgId: '', eventId: '' } };

test.beforeEach(async () => {
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) throw new Error('readme-walk.spec empties Turnstile rows; run it against a *_test database');
  await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
  await seedHosted('fixtures');
  for (const slug of DEMO_ORGS) {
    const ev = await db.event.findFirstOrThrow({ where: { org: { slug } }, select: { id: true, orgId: true, timezoneLabel: true, salesOpenAt: true } });
    // The same stored offset setEventClock writes; allowed because the CommandLog is still empty.
    await db.event.update({ where: { id: ev.id }, data: { clockOffsetSeconds: toSeconds(timestamp(ev.salesOpenAt, 'salesOpenAt')) - toSeconds(axisNow(new Date(), ev.timezoneLabel)) } });
    ids[slug] = { orgId: ev.orgId, eventId: ev.id };
  }
});
test.afterAll(() => db.$disconnect());

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Event screens' });
const result = (page: Page) => page.getByTestId('result');

/** A new person: their own browser context, signed in from /demo as the README's starting account for that org. */
async function arrive(browser: Browser, org: Org): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/demo');
  await expect(page.getByRole('button', { name: /@(acme|globex)\.demo\.test$/ })).toHaveCount(6); // "lists six seeded accounts"
  await page.getByRole('button', { name: `owner@${org}.demo.test` }).click();
  return page;
}

async function actAs(page: Page, customer: string) {
  await page.locator('select[name="as"]').selectOption(customer);
  await page.getByRole('button', { name: 'Act as' }).click();
  await expect(page.getByRole('heading', { name: `Buy tickets · acting as ${customer}` })).toBeVisible();
}

async function payFor(page: Page, org: Org, hold: string, button: string) {
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: button, exact: true }).click();
  await expect(result(page)).toContainText('OK PAYING');
  await expect(page.getByTestId('paying')).toContainText('Recorded Stripe'); // no card form here: see the header
  expect(await paySucceeded(page, ids[org], hold)).toMatchObject({ status: 'OK', code: 'CONFIRMED' });
  await page.reload(); // "refresh until Your tickets shows…"
}

/** Section A as the screen shows it: per row, each seat's id and whether it can be ticked. */
async function rows(page: Page) {
  return page.locator('.seats').evaluateAll((groups) => groups.map((g) => [...g.querySelectorAll('input[name="seats[]"]')].map((i) => ({ seat: (i as HTMLInputElement).value, open: !(i as HTMLInputElement).disabled }))));
}

async function scan(page: Page, code: string) {
  const before = page.url();
  await page.getByLabel('Ticket code').fill(code);
  await page.getByRole('button', { name: 'Check in' }).click();
  await page.waitForURL((u) => u.href !== before); // each scan lands on ?r=<its own command>
  return result(page);
}

// ---- README steps 1 to 6
async function stepsOneToSix(page: Page, v: Visitor): Promise<Carried> {
  const name = ORGS[v.org];
  const event = `/o/${v.org}/events/${EVENT}`;

  // 1. Sign in and find the event.
  await page.getByRole('link', { name }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Events' }).click();
  await page.getByRole('link', { name: 'Synthetic Night (fixture)' }).first().click();
  await expect(page).toHaveURL(new RegExp(`${event}$`));
  // You should see: two pools (a floor of 800, a balcony of 216) …
  await expect(page.locator('[data-testid^="pool-"]')).toHaveCount(2);
  await expect(page.getByTestId('pool-FLOOR')).toContainText('left of 800');
  await expect(page.getByTestId('pool-BALCONY')).toContainText('left of 216');
  // … and four tiers, each with remaining and available …
  const tiers = page.locator('[data-testid^="tier-"]');
  await expect(tiers).toHaveCount(4);
  for (const t of await tiers.allTextContents()) expect(t).toMatch(/^\d+ remaining · \d+ available/);
  // … and the line "How “available” is worked out": the smaller of what the tier has left and what its pool has left.
  await expect(page.locator('p.scope')).toContainText('How “available” is worked out: available = the smaller of what the tier has left and what its pool has left');
  // The floor's tier allotments add up to more than the floor holds.
  const formulas = await tiers.evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
  const floorAllotments = formulas.filter((f) => f.includes('Pool FLOOR:')).map((f) => Number(f.match(/allotment (\d+)/)![1]));
  expect(floorAllotments).toHaveLength(3);
  expect(floorAllotments.reduce((a, b) => a + b, 0)).toBeGreaterThan(800);

  // 2. Hold two floor tickets, as a customer nobody has used: no "Your holds" and no "Your tickets" after Act as.
  await tabs(page).getByRole('link', { name: 'Buy' }).click();
  await expect(page.locator('select[name="as"] option:not([disabled])')).toHaveCount(700); // "There are 700 (C-0001 to C-0700)"
  await expect(page.locator('select[name="as"] option:not([disabled])').first()).toHaveAttribute('value', 'C-0001');
  await expect(page.locator('select[name="as"] option:not([disabled])').last()).toHaveAttribute('value', 'C-0700');
  await actAs(page, v.floor);
  await expect(page.getByRole('heading', { name: 'Your holds' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your tickets' })).toHaveCount(0);
  await expect(page.getByText(/^Sales (closed|open )/)).toHaveCount(0); // on sale
  // The form starts on tier EARLY, quantity 1: change Tier to ADV and Quantity to 2.
  await expect(page.locator('select[name="tier"]')).toHaveValue('EARLY');
  await expect(page.getByRole('spinbutton', { name: 'Quantity' }).first()).toHaveValue('1');
  await page.locator('select[name="tier"]').selectOption('ADV');
  await page.getByRole('spinbutton', { name: 'Quantity' }).first().fill('2');
  await page.getByRole('button', { name: 'Hold tickets' }).click();
  // You should see: OK HELD and a ten-minute countdown.
  await expect(result(page)).toContainText('OK HELD');
  const ga = (await result(page).textContent())!.match(/H-[0-9A-F]{8}/)![0];
  await expect(page.getByTestId(`hold-${ga}`).getByRole('timer')).toHaveText(/^(10:00|09:[3-5]\d) left$/);

  // 3. Pay $76.98 (2 × $34.99 + 2 × $3.50 fee); Your tickets then shows one order with two ticket codes.
  await expect(page.getByTestId(`hold-${ga}`)).toContainText('2 × ($34.99 + $3.50 fee) = $76.98');
  await payFor(page, v.org, ga, 'Pay $76.98');
  const gaOrder = page.getByTestId(/^order-ORD-/);
  await expect(gaOrder).toHaveCount(1);
  await expect(gaOrder.locator('code')).toHaveCount(2);
  const floorCodes = await gaOrder.locator('code').allTextContents();
  const floorOrder = (await gaOrder.getAttribute('data-testid'))!.replace('order-', '');

  // 4. Two balcony seats as another unused customer, and the seat you cannot strand.
  await actAs(page, v.balcony);
  await expect(page.getByRole('heading', { name: 'Your holds' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your tickets' })).toHaveCount(0);
  const seats = await rows(page);
  // Two open seats with one open seat between them → refused, ORPHAN_SEAT.
  const gap = seats.flatMap((r) => r.flatMap((s, i) => (s.open && r[i + 1]?.open && r[i + 2]?.open ? [[s.seat, r[i + 2]!.seat]] : [])))[0]!;
  for (const s of gap) await page.getByLabel(`${s} open`).check();
  await page.getByRole('button', { name: 'Hold seats in A' }).click();
  await expect(result(page)).toContainText('REJECT ORPHAN_SEAT');
  await expect(page.locator('.notice').filter({ has: result(page) })).toContainText('stranded between two taken ones');
  // PRD-4 item 19 (D-80): the page names the seat in the middle, and the two seats stay ticked; the README says to untick them.
  const middle = seats.flatMap((r) => r).find((x) => x.seat > gap[0]! && x.seat < gap[1]!)!.seat;
  await expect(page.getByTestId('stranded')).toContainText(middle);
  for (const s of gap) await expect(page.getByLabel(`${s} open`)).toBeChecked();
  for (const s of gap) await page.getByLabel(`${s} open`).uncheck();
  // Two open seats side by side. A second visitor has to pick a pair that strands nobody: next to taken seats or a row end.
  const taken = (r: { open: boolean }[], i: number) => i >= 0 && i < r.length && !r[i]!.open;
  const pair = seats.flatMap((r) => r.flatMap((s, i) => (s.open && r[i + 1]?.open && !(r[i - 1]?.open && taken(r, i - 2)) && !(r[i + 2]?.open && taken(r, i + 3)) ? [[s.seat, r[i + 1]!.seat]] : [])))[0]!;
  for (const s of pair) await page.getByLabel(`${s} open`).check();
  await page.getByRole('button', { name: 'Hold seats in A' }).click();
  await expect(result(page)).toContainText('OK HELD');
  const held = (await result(page).textContent())!.match(/H-[0-9A-F]{8}/)![0];
  await expect(page.getByTestId(`hold-${held}`)).toContainText(pair.join(', '));
  await expect(page.getByTestId(`hold-${held}`)).toContainText('2 × ($60.00 + $3.50 fee) = $127.00');
  await payFor(page, v.org, held, 'Pay $127.00');
  const seatOrder = page.getByTestId(/^order-ORD-/);
  await expect(seatOrder).toHaveCount(1);
  await expect(seatOrder.locator('code')).toHaveCount(2);
  const balconyCode = (await seatOrder.locator('code').allTextContents())[0]!;

  // 5. Refund one ticket at the box office: your order, not somebody else's.
  await page.goto(event);
  const advBefore = Number((await page.getByTestId('tier-ADV').textContent())!.match(/^(\d+) remaining/)![1]);
  const floorBefore = Number((await page.getByTestId('pool-FLOOR').locator('.fig-lg').textContent())!.replace(/,/g, ''));
  await tabs(page).getByRole('link', { name: 'Box office' }).click();
  await expect(page.getByRole('heading', { name: 'Refund a ticket' })).toBeVisible();
  const mine = page.locator('select[name="order"] option', { hasText: `· ${v.floor} ·` });
  await expect(mine).toHaveCount(1); // exactly one order is "yours" when the customer was unused
  expect(await mine.getAttribute('value')).toBe(floorOrder);
  await page.locator('select[name="order"]').selectOption(floorOrder);
  await page.getByRole('button', { name: 'Open order' }).click();
  await page.locator('input[name="t"]').first().check();
  await page.getByRole('button', { name: 'Preview refund' }).click();
  // You should see: the days before the show, the window that applies, and the amount: the full $38.49, fee included.
  const preview = page.getByTestId('preview');
  await expect(preview).toContainText(/\d+ days before the show/);
  const days = Number((await preview.textContent())!.match(/(\d+) days before the show/)![1]);
  expect(days).toBeGreaterThanOrEqual(30); // what the README's figures assume
  await expect(preview).toContainText('full refund, fee included');
  await expect(page.getByTestId('preview-total')).toHaveText('$38.49');
  // Refund $38.49: the recorded refund equals the preview to the cent, and the ticket goes back into the pool.
  await page.getByRole('button', { name: 'Refund $38.49', exact: true }).click();
  await expect(result(page)).toContainText('OK REFUNDED');
  await expect(result(page)).toContainText('3849');
  const recorded = await db.refund.findMany({ where: { eventId: ids[v.org].eventId, orderId: floorOrder }, select: { amountCents: true } });
  expect(recorded.map((r) => r.amountCents)).toEqual([3849]);
  await page.goto(event);
  await expect(page.getByTestId('tier-ADV')).toHaveText(new RegExp(`^${advBefore + 1} remaining`));
  expect(Number((await page.getByTestId('pool-FLOOR').locator('.fig-lg').textContent())!.replace(/,/g, ''))).toBe(floorBefore + 1);

  // 6. The ledger: captured, refunded and net; one line per captured payment; captured − refunded = net.
  await tabs(page).getByRole('link', { name: 'Ledger' }).click();
  const [captured, refunded, net] = await Promise.all(['captured', 'refunded', 'net'].map(async (id) => cents((await page.getByTestId(id).textContent())!)));
  expect(captured! - refunded!).toBe(net);
  const payments = await db.payment.count({ where: { eventId: ids[v.org].eventId, state: { in: ['SUCCEEDED', 'SUCCEEDED_LATE'] } } });
  await expect(page.locator('[data-testid^="pay-"]')).toHaveCount(payments);
  for (const who of [v.floor, v.balcony]) await expect(page.locator('[data-testid^="pay-"]').filter({ hasText: who })).toHaveCount(1);
  // If you are the first visitor since a reset: $203.98, $38.49, $165.49. Otherwise the totals include earlier visitors.
  if (v.firstInOrg) expect([captured, refunded, net]).toEqual([20398, 3849, 16549]);
  else expect(captured).toBeGreaterThan(20398);
  // Download CSV holds the same lines in integer cents.
  const link = page.getByRole('link', { name: 'Download CSV' });
  await expect(link).toBeVisible();
  const csv = (await (await page.request.get((await link.getAttribute('href'))!)).text()).trim().split('\r\n').map((l) => l.split(','));
  expect(csv[0]).toEqual(['payment_id', 'order_id', 'customer', 'tier', 'qty', 'captured_cents', 'refunded_cents', 'net_cents', 'late']);
  expect(csv).toHaveLength(1 + payments);
  const col = (n: number) => csv.slice(1).reduce((a, l) => a + Number(l[n]), 0);
  expect([col(5), col(6), col(7)]).toEqual([captured, refunded, net]);
  expect(csv.slice(1).filter((l) => l[2] === v.floor).map((l) => l.slice(5, 8))).toEqual([['7698', '3849', '3849']]);
  expect(csv.slice(1).filter((l) => l[2] === v.balcony).map((l) => l.slice(5, 8))).toEqual([['12700', '0', '12700']]);

  return { floorCodes, balconyCode };
}

// ---- README step 7 (the one-way step)
async function stepSeven(page: Page, v: Visitor, c: Carried) {
  const event = `/o/${v.org}/events/${EVENT}`;
  await tabs(page).getByRole('link', { name: 'Door' }).click();
  // You should see: DO NOT ADMIT; doors are not open yet, they open at 2027-03-20 19:00.
  await expect(await scan(page, c.balconyCode)).toContainText('Doors are not open yet; they open at 2027-03-20 19:00');
  await expect(page.getByText('DO NOT ADMIT', { exact: true })).toBeVisible();

  // Event → Event clock → set it → Set clock.
  await tabs(page).getByRole('link', { name: 'Event', exact: true }).click();
  const field = page.getByLabel('Set the event clock to');
  if (v.clock.type) {
    // Typed the way a visitor does in the browser's 12-hour field (en-US): month, day, year, then on to the hour,
    // minute, second and AM/PM. The year takes more than four digits, so the visitor moves on from it by hand.
    await field.focus();
    await page.keyboard.type(v.clock.type[0]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(v.clock.type[1]);
  } else await field.fill(v.clock.fill);
  await expect(field).toHaveValue(v.clock.fill); // a whole minute comes back without ":00"; the action puts it back
  await page.getByRole('button', { name: 'Set clock' }).click();
  await expect(page.getByTestId('event-clock')).toHaveText(new RegExp(`^${v.clock.shows}`));

  // Back on Door, the same code says ADMIT; scan it again and it is refused with the time of the first scan.
  await page.goto(`${event}/door`);
  await expect(await scan(page, c.balconyCode)).toContainText('Admit.');
  await expect(page.getByText('ADMIT', { exact: true })).toBeVisible();
  const again = await scan(page, c.balconyCode);
  await expect(again).toContainText(`first checked in at ${v.clock.shows}`);
  await expect(page.getByText('DO NOT ADMIT', { exact: true })).toBeVisible();
  // Of your two floor codes one is admitted and the refunded one is refused as refunded.
  const answers: string[] = [];
  for (const code of c.floorCodes) answers.push((await (await scan(page, code)).textContent())!);
  expect(answers.filter((a) => a.includes('Admit.'))).toHaveLength(1);
  expect(answers.filter((a) => a.includes('was refunded and is not valid for entry'))).toHaveLength(1);
}

test('A: the first visitor finishes in acme; the second finds acme spent and does the whole walk in globex', async ({ browser }) => {
  test.setTimeout(180_000);
  const one: Visitor = { org: 'acme', floor: 'C-0417', balcony: 'C-0418', firstInOrg: true, clock: { fill: '2027-03-20T19:00:05', shows: '2027-03-20 19:00' } };
  const first = await arrive(browser, 'acme');
  await stepSeven(first, one, await stepsOneToSix(first, one));

  // "Step 7 uses the demo up": what the next person finds in acme. Straight away ADV is off sale (it stopped at 17:00
  // on show night), so step 2 cannot be done there; "Sales closed" itself appears once the clock passes 20:00.
  const second = await arrive(browser, 'acme');
  await second.goto(`/o/acme/events/${EVENT}/buy?as=C-0522`);
  await expect(second.locator('select[name="tier"] option', { hasText: 'ADV' })).toContainText('off sale');
  await second.locator('select[name="tier"]').selectOption('ADV');
  await second.getByRole('spinbutton', { name: 'Quantity' }).first().fill('2');
  await second.getByRole('button', { name: 'Hold tickets' }).click();
  await expect(result(second)).toContainText('REJECT');
  await expect(second.getByText('Sales closed', { exact: true })).toHaveCount(0); // not yet: sales close at 20:00, an hour after doors
  // An hour later on the event clock (the stored offset moved on; nobody pressed anything):
  await db.event.update({ where: { id: ids.acme.eventId }, data: { clockOffsetSeconds: { increment: 3600 } } });
  await second.goto(`/o/acme/events/${EVENT}/buy?as=C-0522`);
  await expect(second.getByText('Sales closed', { exact: true })).toBeVisible();

  // So, as the README says, the same person does the walk as owner@globex.demo.test in Globex Labs.
  await second.goto('/demo');
  await second.getByRole('button', { name: 'owner@globex.demo.test' }).click();
  const two: Visitor = { org: 'globex', floor: 'C-0522', balcony: 'C-0523', firstInOrg: true, clock: { type: ['03202027', '073000PM'], fill: '2027-03-20T19:30', shows: '2027-03-20 19:30' } };
  await stepSeven(second, two, await stepsOneToSix(second, two));

  // The two orgs never mixed: each ledger holds its own two payments.
  for (const org of DEMO_ORGS) expect(await db.payment.count({ where: { eventId: ids[org].eventId } })).toBe(2);
  await first.context().close();
  await second.context().close();
});

test('B: the first visitor stops after step 6; the second does the whole walk in the same org as a different fresh customer', async ({ browser }) => {
  test.setTimeout(180_000);
  const one: Visitor = { org: 'acme', floor: 'C-0101', balcony: 'C-0102', firstInOrg: true, clock: { fill: '', shows: '' } };
  const first = await arrive(browser, 'acme');
  await stepsOneToSix(first, one);
  // The first visitor also leaves a live hold behind, unpaid: the second must not see it or be able to pay for it.
  await first.goto(`/o/acme/events/${EVENT}/buy?as=${one.floor}`);
  await first.locator('select[name="tier"]').selectOption('ADV');
  await first.getByRole('button', { name: 'Hold tickets' }).click();
  await expect(result(first)).toContainText('OK HELD');
  await first.context().close();

  const two: Visitor = { org: 'acme', floor: 'C-0355', balcony: 'C-0356', firstInOrg: false, clock: { type: ['03202027', '070005PM'], fill: '2027-03-20T19:00:05', shows: '2027-03-20 19:00' } };
  const second = await arrive(browser, 'acme');
  // "If the page then shows Your holds or Your tickets, an earlier visitor used that customer": the first visitor's
  // floor customer shows both to the second visitor (the live hold and the order), which is the cue to pick another.
  await second.goto(`/o/acme/events/${EVENT}/buy?as=${one.floor}`);
  await expect(second.getByRole('heading', { name: 'Your holds' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Your tickets' })).toBeVisible();
  await second.goto('/demo');
  await second.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  const carried = await stepsOneToSix(second, two);
  // The shared ledger now holds both visitors' purchases and refunds, to the cent: twice the README's first-visitor figures.
  await expect(second.getByTestId('captured')).toHaveText('$407.96');
  await expect(second.getByTestId('refunded')).toHaveText('$76.98');
  await expect(second.getByTestId('net')).toHaveText('$330.98');
  await stepSeven(second, two, carried);
  await second.context().close();
});
