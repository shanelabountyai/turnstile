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
  await expect(page.getByRole('heading', { name: 'Acting as', exact: true })).not.toBeInViewport();
  await link.click();
  await expect(page).toHaveURL(/#as$/);
  await expect(page.getByRole('heading', { name: 'Acting as', exact: true })).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'Customer' })).toBeInViewport();
});

test('an orphan refusal names the stranded seat and keeps the pick ticked, in the section it was made', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0002`);
  await page.getByLabel('A-A-01 open').check();
  await page.getByLabel('A-A-03 open').check();
  await page.getByRole('button', { name: 'Hold seats in A' }).click();
  await expect(page.getByTestId('result')).toContainText('REJECT ORPHAN_SEAT');
  await expect(page.getByTestId('stranded')).toHaveText('Seat A-A-02 would be left on its own.');
  await expect(page.getByLabel('A-A-01 open')).toBeChecked();
  await expect(page.getByLabel('A-A-03 open')).toBeChecked();
  await expect(page.getByLabel('A-A-02 open')).not.toBeChecked();
  // pressing "Hold seats" again sends the same pick, and gets the same answer (a new command: wait for its redirect)
  const first = page.url();
  await page.getByRole('button', { name: 'Hold seats in A' }).click();
  await page.waitForURL((u) => u.href !== first);
  await expect(page.getByTestId('result')).toContainText('REJECT ORPHAN_SEAT');
  await expect(page.getByTestId('stranded')).toHaveText('Seat A-A-02 would be left on its own.');

  // In section B the refusal comes back on section B, not the first section.
  await page.getByRole('navigation', { name: 'Balcony sections' }).getByRole('link', { name: /^Section B/ }).click();
  await page.getByLabel('B-C-05 open').check();
  await page.getByLabel('B-C-07 open').check();
  await page.getByRole('button', { name: 'Hold seats in B' }).click();
  await expect(page.getByTestId('result')).toContainText('REJECT ORPHAN_SEAT');
  await expect(page.getByRole('navigation', { name: 'Balcony sections' }).getByRole('link', { name: /^Section B/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('stranded')).toHaveText('Seat B-C-06 would be left on its own.');
  await expect(page.getByLabel('B-C-05 open')).toBeChecked();
  await expect(page.getByLabel('B-C-07 open')).toBeChecked();

  // A pick that is accepted comes back unticked, with no stranded sentence.
  await page.getByLabel('B-C-07 open').uncheck();
  await page.getByLabel('B-C-06 open').check();
  await page.getByRole('button', { name: 'Hold seats in B' }).click();
  await expect(page.getByTestId('result')).toContainText('OK HELD');
  await expect(page.getByTestId('stranded')).toHaveCount(0);
  // no seat on the page is still ticked; in section B the held seats read "held", unticked (the page opens on section A
  // after an accepted hold: D-77 brings only a refused pick back to its section)
  await expect(page.locator('input[name="seats[]"]:checked')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Balcony sections' }).getByRole('link', { name: /^Section B/ }).click();
  await expect(page.getByLabel('B-C-05 held')).not.toBeChecked();
  await expect(page.getByLabel('B-C-06 held')).not.toBeChecked();
  await expect(page.locator('input[name="seats[]"]:checked')).toHaveCount(0);
});
