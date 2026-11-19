import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { EVENT, freshEvent, holdGa, paySucceeded, setClock, signIn } from './turnstile';

// Task 3.4: the Buy screen on a freshly loaded fixture event (no commands cast), with the event clock moved into the
// sales window (D-35) and Stripe recorded (no key on the server under test). The webhook is posted the way Stripe
// would, signed with the fixture secret.
let ids = { orgId: '', eventId: '' };

test.beforeAll(async () => { ids = await freshEvent('buy.spec'); });
test.afterAll(() => db.$disconnect());

test('hold → pay → signed webhook → tickets; an expired hold shows its code; an orphan pick is refused', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');

  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  await expect(page.getByRole('heading', { name: 'Buy tickets · acting as C-0001' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Event screens' }).getByRole('link', { name: 'Buy' })).toHaveAttribute('aria-current', 'page');
  const hold = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText(`OK PAYING · pi_rec_${hold} 7698`); // 2 × (3,499 + 350) ¢
  await expect(page.getByTestId('paying')).toContainText('Recorded Stripe');
  await expect(page.getByRole('complementary', { name: 'Where you are' }).locator('[aria-current="step"]')).toHaveText(/^Pay while held/);

  expect(await paySucceeded(page, ids, hold)).toMatchObject({ status: 'OK', code: 'CONFIRMED' });

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
  // Design pass (D-37): the refusal is in words first, and the section tabs switch the rows shown.
  await expect(page.locator('.notice').filter({ has: page.getByTestId('result') })).toContainText('stranded between two taken ones');
  await page.getByRole('navigation', { name: 'Balcony sections' }).getByRole('link', { name: /^Section B/ }).click();
  await expect(page.getByLabel('B-A-01 open')).toBeVisible();
  await expect(page.getByLabel('A-A-01 open')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hold seats in B' })).toBeVisible();
});
