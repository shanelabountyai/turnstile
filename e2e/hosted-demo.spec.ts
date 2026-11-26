import { expect, test, type Page } from '@playwright/test';
import { axisNow } from '@/checkout/clock';
import { dollars } from '@/checkout/read';
import { db } from '@/core/db';
import { timestamp, toSeconds } from '@/inventory/time';
import { DEMO_ORGS, seedHosted } from '../scripts/seed-hosted';
import { EVENT, holdGa, paySucceeded, setClock } from './turnstile';

// Deploy prep (D-47, D-49): the README's "Try the live demo" walk, in one browser session against the production
// build, on a database that holds only what a Production deploy puts there: the migrations, then scripts/seed-hosted.ts
// (demo accounts, the fixture event loaded into each demo org, nothing sold). Demo sign-in → event → a GA purchase →
// a reserved-seat purchase → box office refund → ledger → door.
//
// What stands in for Stripe here: the server under test has no Stripe key, so Pay answers from StripeRecorded and the
// success webhook is posted signed with the published fixture secret (playwright.config.ts). A deployed demo uses
// Stripe test mode and Stripe's own webhook; that round trip is the owner's hand step (docs/DEPLOY.md) and is not
// proven by this spec.
let ids = { orgId: '', eventId: '' };

test.beforeAll(async () => {
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) throw new Error('hosted-demo.spec empties Turnstile rows; run it against a *_test database');
  await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
  await seedHosted('fixtures');
  await clocksToSalesOpen();
  const orgId = (await db.org.findUniqueOrThrow({ where: { slug: 'acme' }, select: { id: true } })).id;
  ids = { orgId, eventId: (await db.event.findFirstOrThrow({ where: { orgId }, select: { id: true } })).id };
});
test.afterAll(() => db.$disconnect());

// The seed sets the clock to sales open only while the wall clock is still before it (D-47). From 2026-12-01 10:00 on
// it leaves the event on the wall clock, and this spec's hold/release steps would silently stop running. So the spec
// puts both freshly seeded events at the moment sales open itself, whatever the wall date (review item 18, CODE-9):
// the same stored offset setEventClock writes, allowed because the CommandLog is still empty.
async function clocksToSalesOpen() {
  for (const ev of await db.event.findMany({ where: { org: { slug: { in: [...DEMO_ORGS] } } }, select: { id: true, timezoneLabel: true, salesOpenAt: true } })) {
    const offset = toSeconds(timestamp(ev.salesOpenAt, 'salesOpenAt')) - toSeconds(axisNow(new Date(), ev.timezoneLabel));
    await db.event.update({ where: { id: ev.id }, data: { clockOffsetSeconds: offset } });
  }
}

async function payFor(page: Page, hold: string) {
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: /^Pay \$/ }).click();
  await expect(page.getByTestId('result')).toContainText('OK PAYING');
  expect(await paySucceeded(page, ids, hold)).toMatchObject({ status: 'OK', code: 'CONFIRMED' });
  await page.reload();
}

async function scan(page: Page, code: string) {
  const before = page.url();
  await page.getByLabel('Ticket code').fill(code);
  await page.getByRole('button', { name: 'Check in' }).click();
  await page.waitForURL((u) => u.href !== before); // each scan lands on ?r=<its own command>, so the answer read next is this scan's
  return page.getByTestId('result');
}

// Not every /demo account can make the one-way clock move (D-49): a member sells like anyone, and the clock refuses them.
test('a demo member can hold and release a ticket, and is refused the event clock', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'member@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();
  await page.goto(`/o/acme/events/${EVENT}`);
  const before = await page.getByTestId('event-clock').textContent();
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0003`);
  const hold = await holdGa(page, 'ADV', 1);
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: 'Release' }).click();
  await expect(page.getByTestId('result')).toContainText('OK RELEASED');
  await page.goto(`/o/acme/events/${EVENT}`);
  // A member is not offered the clock form and is told who can move it (D-65); e2e/event-clock.spec.ts posts the action anyway.
  await expect(page.getByTestId('clock-movers')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set clock' })).toHaveCount(0);
  await page.goto(`/o/acme/events/${EVENT}`);
  await expect(page.getByTestId('event-clock')).toHaveText(new RegExp(`^${before!.slice(0, 13)}`)); // same hour: the clock did not jump to show night
});

test('the live-demo walk on a freshly deployed database: sign in, buy GA and a reserved pair, refund, ledger, door', async ({ page }) => {
  // 1. Demo sign-in, by clicking through from /demo as a visitor would.
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Events' }).click();
  await page.getByRole('link', { name: 'Synthetic Night (fixture)' }).first().click();

  // 2. The event page. Nothing is sold; the event clock is at the moment sales open (the seed does that before
  // 2026-12-01 10:00, clocksToSalesOpen above whatever the date), so the visitor can buy without touching the clock.
  await expect(page).toHaveURL(new RegExp(`/o/acme/events/${EVENT}$`));
  await expect(page.getByTestId('pool-FLOOR')).toBeVisible();
  await expect(page.getByTestId('tier-ADV')).toContainText('400 remaining · 400 available');
  await expect(page.getByTestId('event-clock')).toHaveText(/^2026-12-01 10:[0-2]\d/);

  // 3. A GA purchase: two Advance tickets, 2 × (3,499 + 350) ¢.
  await page.getByRole('navigation', { name: 'Event screens' }).getByRole('link', { name: 'Buy' }).click();
  await page.locator('select[name="as"]').selectOption('C-0001');
  await page.getByRole('button', { name: 'Act as' }).click();
  await expect(page.getByRole('heading', { name: 'Buy tickets · acting as C-0001' })).toBeVisible();
  await expect(page.getByText(/^Sales (closed|open )/)).toHaveCount(0); // on sale: no "Sales open …" notice
  const ga = await holdGa(page, 'ADV', 2);
  await payFor(page, ga);
  const gaOrder = page.getByTestId(/^order-ORD-/);
  await expect(gaOrder).toHaveCount(1);
  await expect(gaOrder.locator('code')).toHaveCount(2);
  const gaCodes = await gaOrder.locator('code').allTextContents();

  // 4. A reserved purchase as another customer: two seats side by side in balcony section A, 2 × (6,000 + 350) ¢.
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0002`);
  await page.getByLabel('A-A-01 open').check();
  await page.getByLabel('A-A-02 open').check();
  await page.getByRole('button', { name: 'Hold seats in A' }).click();
  await expect(page.getByTestId('result')).toContainText('OK HELD');
  const seats = (await page.getByTestId('result').textContent())!.match(/H-[0-9A-F]{8}/)![0];
  await expect(page.getByTestId(`hold-${seats}`)).toContainText('A-A-01, A-A-02');
  await payFor(page, seats);
  const seatOrder = page.getByTestId(/^order-ORD-/);
  await expect(seatOrder).toHaveCount(1);
  const [seatCode] = await seatOrder.locator('code').allTextContents();

  // 5. Box office: refund one of the two GA tickets. More than 30 days out, so the whole price and the fee come back.
  await page.getByRole('navigation', { name: 'Event screens' }).getByRole('link', { name: 'Box office' }).click();
  const pick = page.locator('select[name="order"] option', { hasText: 'C-0001' });
  await page.locator('select[name="order"]').selectOption((await pick.getAttribute('value'))!);
  await page.getByRole('button', { name: 'Open order' }).click();
  await page.locator('input[name="t"]').first().check();
  await page.getByRole('button', { name: 'Preview refund' }).click();
  await expect(page.getByTestId('preview-total')).toHaveText(dollars(3849));
  await page.getByRole('button', { name: /^Refund \$/ }).click();
  await expect(page.getByTestId('result')).toContainText('OK REFUNDED');

  // 6. Ledger: two captured payments, one refund, and the three figures add up.
  await page.getByRole('navigation', { name: 'Event screens' }).getByRole('link', { name: 'Ledger' }).click();
  await expect(page.getByTestId('captured')).toHaveText(dollars(7698 + 12700));
  await expect(page.getByTestId('refunded')).toHaveText(dollars(3849));
  await expect(page.getByTestId('net')).toHaveText(dollars(7698 + 12700 - 3849));
  const csv = await (await page.request.get(`/o/acme/events/${EVENT}/ledger/csv`)).text();
  expect(csv.trim().split('\r\n')).toHaveLength(3); // header + one line per captured payment

  // 7. Door. Before doors every scan is refused with the reason; the clock then moves to show night (one way, D-49).
  await page.getByRole('navigation', { name: 'Event screens' }).getByRole('link', { name: 'Door' }).click();
  await expect(await scan(page, seatCode!)).toContainText('Doors are not open yet; they open at 2027-03-20 19:00:00');
  await setClock(page, '2027-03-20T19:00:05');
  await page.goto(`/o/acme/events/${EVENT}/door`);
  await expect(page.getByTestId('live')).toHaveText('3');
  await expect(await scan(page, seatCode!)).toContainText('Admit.');
  await expect(page.getByText('ADMIT', { exact: true })).toBeVisible();
  await expect(await scan(page, seatCode!)).toContainText('first checked in at');
  // Of the two GA tickets one was refunded at the box office: one scan admits, the other is refused as refunded.
  const answers: string[] = [];
  for (const code of gaCodes) answers.push((await (await scan(page, code)).textContent())!);
  expect(answers.filter((a) => a.includes('Admit.'))).toHaveLength(1);
  expect(answers.filter((a) => a.includes('was refunded'))).toHaveLength(1);
  await expect(page.getByTestId('checked-in')).toHaveText('2');
});
