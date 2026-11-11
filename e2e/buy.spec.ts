import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loadFixtureEvent } from '@/checkout/load';
import { signStripePayload } from '@/checkout/webhook';
import { db } from '@/core/db';
import { seedDemo } from '../scripts/seed-demo';

// Task 3.4: the Buy screen on a freshly loaded fixture event (no commands cast), with the event clock moved into the
// sales window (D-35) and Stripe recorded (no key on the server under test). The webhook is posted the way Stripe
// would, signed with the fixture secret.
const EVENT = 'EV-SYNTH-001';
const SECRET = (JSON.parse(readFileSync('fixtures/stripe/webhook.json', 'utf8')) as { secret: string }).secret;
let orgId = '';
let eventId = '';

test.beforeAll(async () => {
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) throw new Error('buy.spec empties Turnstile rows; run it against a *_test database');
  await seedDemo();
  await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
  orgId = (await db.org.findUniqueOrThrow({ where: { slug: 'acme' }, select: { id: true } })).id;
  eventId = (await loadFixtureEvent(orgId, 'fixtures')).eventId;
});
test.afterAll(() => db.$disconnect());

async function setClock(page: Page, to: string) {
  await page.goto(`/o/acme/events/${EVENT}`);
  await page.getByLabel('Set the event clock to').fill(to);
  await page.getByRole('button', { name: 'Set clock' }).click();
  await expect(page.getByTestId('event-clock')).toHaveText(new RegExp(`^${to.slice(0, 16).replace('T', ' ')}`));
}

async function holdGa(page: Page, tier: string, qty: number): Promise<string> {
  await page.locator('select[name="tier"]').selectOption(tier);
  await page.getByRole('spinbutton', { name: 'Quantity' }).first().fill(String(qty));
  await page.getByRole('button', { name: 'Hold tickets' }).click();
  await expect(page.getByTestId('result')).toContainText('OK HELD');
  return (await page.getByTestId('result').textContent())!.match(/H-[0-9A-F]{8}/)![0];
}

test('hold → pay → signed webhook → tickets; an expired hold shows its code; an orphan pick is refused', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await setClock(page, '2026-12-01T10:05:30');

  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  await expect(page.getByRole('heading', { name: 'Buy · acting as C-0001' })).toBeVisible();
  const hold = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText(`OK PAYING · pi_rec_${hold} 7698`); // 2 × (3,499 + 350) ¢
  await expect(page.getByTestId('paying')).toContainText('Recorded Stripe');

  const body = JSON.stringify({
    id: `evt_e2e_${hold}`, object: 'event', type: 'payment_intent.succeeded',
    data: { object: { id: `pi_rec_${hold}`, object: 'payment_intent', metadata: { hold_id: hold, org_id: orgId, event_id: eventId } } },
  });
  const res = await page.request.post('/api/checkout/webhook', { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(body, SECRET, Math.floor(Date.now() / 1000)) } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'OK', code: 'CONFIRMED' });

  await page.reload();
  const order = page.getByTestId(/^order-ORD-/);
  await expect(order).toHaveCount(1);
  await expect(order.locator('code')).toHaveCount(2);
  await expect(order.locator('code').first()).toHaveText(/^[0-9a-f]{20}$/);

  // Expiry: a second tab keeps the Pay button for a held cart; the clock moves past the 10-minute hold; Pay is refused.
  const stale = await holdGa(page, 'ADV', 1);
  const tab = await page.context().newPage();
  await tab.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  await expect(tab.getByTestId(`hold-${stale}`).getByRole('timer')).toBeVisible();
  await setClock(page, '2026-12-01T10:30:30');
  await tab.getByTestId(`hold-${stale}`).getByRole('button', { name: 'Pay' }).click();
  await expect(tab.getByTestId('result')).toContainText('REJECT HOLD_EXPIRED');
  await expect(tab.getByTestId(`hold-${stale}`)).toContainText('HOLD_EXPIRED');

  // Orphan rule: seats 1 and 3 of an empty row would strand seat 2.
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0002`);
  await page.getByLabel('A-A-01 open').check();
  await page.getByLabel('A-A-03 open').check();
  await page.getByRole('button', { name: 'Hold seats in A' }).click();
  await expect(page.getByTestId('result')).toContainText('REJECT ORPHAN_SEAT');
});
