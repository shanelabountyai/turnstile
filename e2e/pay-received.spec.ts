import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { EVENT, freshEvent, holdGa, paySucceeded, setClock, signIn } from './turnstile';

// PRD-3 item 10: back from Stripe with `redirect_status=succeeded`, a hold that is still PAYING (the signed webhook has
// not landed yet) shows "Payment received by Stripe…" and no card form; when the webhook lands the tickets appear.
//
// What stands in for Stripe: the server under test has no key, so Pay answers from StripeRecorded, and this spec types
// the two query parameters Stripe appends to `return_url` itself. The live redirect, the live card form and its loading
// label are not exercised here (no key enters CI, non-negotiable 11): they are the owner's O-8 to observe.
let ids = { orgId: '', eventId: '' };
test.beforeAll(async () => { ids = await freshEvent('pay-received.spec'); });
test.afterAll(() => db.$disconnect());

test('a return with redirect_status=succeeded shows "Payment received by Stripe", no card form, then the tickets', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  const buy = `/o/acme/events/${EVENT}/buy?as=C-0001`;
  await page.goto(buy);
  const paid = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${paid}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText(`OK PAYING · pi_rec_${paid}`);
  const other = await holdGa(page, 'ADV', 1);
  await page.getByTestId(`hold-${other}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText(`OK PAYING · pi_rec_${other}`);

  // Before the return: both holds wait for the webhook, neither says "received".
  await page.goto(buy);
  await expect(page.getByTestId('pay-received')).toHaveCount(0);
  await expect(page.getByTestId('paying')).toHaveCount(2);

  // Stripe's redirect back names one PaymentIntent. That hold, and only that hold, says the payment was received.
  await page.goto(`${buy}&payment_intent=pi_rec_${paid}&payment_intent_client_secret=not_read&redirect_status=succeeded`);
  const received = page.getByTestId(`hold-${paid}`).getByTestId('pay-received');
  await expect(received).toContainText('Payment received by Stripe; tickets appear when Stripe confirms it.');
  await expect(received).toHaveAttribute('role', 'status');
  await expect(page.getByTestId(`hold-${paid}`).getByTestId('paying')).toHaveCount(0);
  await expect(page.getByTestId(`hold-${paid}`).getByRole('button')).toHaveCount(0); // no card form, no Pay button
  await expect(page.getByRole('button', { name: /Pay with Stripe|Loading the card form/ })).toHaveCount(0);
  await expect(page.getByTestId(`hold-${other}`).getByTestId('paying')).toBeVisible();
  await expect(page.getByTestId(`hold-${other}`).getByTestId('pay-received')).toHaveCount(0);
  await expect(page.getByTestId(`hold-${paid}`)).toContainText('PAYING'); // still the engine's state: nothing is sold by a query string

  // A redirect that did not succeed, or that names another PaymentIntent, changes nothing.
  await page.goto(`${buy}&payment_intent=pi_rec_${paid}&redirect_status=failed`);
  await expect(page.getByTestId('pay-received')).toHaveCount(0);
  await page.goto(`${buy}&payment_intent=pi_someone_elses&redirect_status=succeeded`);
  await expect(page.getByTestId('pay-received')).toHaveCount(0);

  // The signed webhook is what issues the tickets; the same return URL then shows them and no PAYING hold for that payment.
  expect(await paySucceeded(page, ids, paid)).toMatchObject({ status: 'OK', code: 'CONFIRMED' });
  await page.goto(`${buy}&payment_intent=pi_rec_${paid}&redirect_status=succeeded`);
  await expect(page.getByTestId('pay-received')).toHaveCount(0);
  await expect(page.getByTestId(/^order-ORD-/)).toHaveCount(1);
});
