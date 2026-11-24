import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { EVENT, freshEvent, holdGa, paySucceeded, setClock, signIn } from './turnstile';

// PRD-4 item 17 (UX-11, DES-11, UX-17, UX-9) on a freshly loaded fixture event with Stripe recorded: the "Payment
// started" banner is gone once the order exists; the ledger says "1 order" and "1 line"; "Change customer" by the Buy
// title jumps to the picker.
let ids = { orgId: '', eventId: '' };
test.beforeAll(async () => { ids = await freshEvent('prd4-buy.spec'); });
test.afterAll(() => db.$disconnect());

test('the "Payment started" banner goes once the order exists; the ledger counts 1 order and 1 line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  const hold = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText('OK PAYING'); // still paying: the banner is current
  await expect(page.getByText('Payment started.')).toBeVisible();
  const paying = page.url();

  expect(await paySucceeded(page, ids, hold)).toMatchObject({ status: 'OK', code: 'CONFIRMED' });
  await page.goto(paying); // the same URL, ?r= still naming the PAY_START command
  await expect(page.getByTestId(/^order-ORD-/)).toHaveCount(1);
  await expect(page.getByTestId('result')).toHaveCount(0);
  await expect(page.getByText('Payment started.')).toHaveCount(0);

  await page.goto(`/o/acme/events/${EVENT}/ledger`);
  await expect(page.getByText(/· 1 order and 0 late payments$/)).toBeVisible();
  await expect(page.getByText('1 line', { exact: true })).toBeVisible();
  await expect(page.getByText(/1 orders|1 lines/)).toHaveCount(0);
});

test('"Change customer" sits by the Buy title and jumps to the picker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto(`/o/acme/events/${EVENT}/buy`);
  await expect(page.getByRole('link', { name: 'Change customer' })).toHaveCount(0); // no customer yet: the picker is on top
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  const link = page.locator('header.page-head').getByRole('link', { name: 'Change customer' });
  await expect(link).toHaveAttribute('href', '#as');
  await expect(page.getByRole('heading', { name: 'Acting as' })).not.toBeInViewport();
  await link.click();
  await expect(page).toHaveURL(/#as$/);
  await expect(page.getByRole('heading', { name: 'Acting as' })).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'Customer' })).toBeInViewport();
});
