import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { E2E_CRON_SECRET } from '../playwright.config';
import { EVENT, freshEvent, holdGa, setClock, signIn } from './turnstile';

// D-60, end to end on the production build: the cron route, called the way Vercel Cron calls it, resets the demo.
// The server under test runs with DEMO_MODE=1 (playwright.config.ts), so this is the mode in which the reset is
// allowed to run; tests/checkout/demo-reset.test.ts proves it does nothing in any other. Stripe is the recorded double
// (no key on the server under test), so "cancelled" here is the recorded gateway's answer, not Stripe's.
// Not shown here: Vercel's scheduler, Neon, or the bundled fixture files on Vercel's filesystem.
test.beforeAll(async () => { await freshEvent('demo-reset.spec'); });
test.afterAll(() => db.$disconnect());

const cron = { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } };

test('the cron resets a used demo: both orgs back at sales open, nothing sold, the open PaymentIntent cancelled', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  const hold = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText('OK PAYING'); // an open PaymentIntent, left unpaid
  await page.goto(`/o/acme/events/${EVENT}`);
  await expect(page.getByTestId('tier-ADV')).toContainText('398 remaining · 398 available'); // two held
  // Show night, the README's one-way step. The payment's 30 minutes are long gone on the event clock, but nothing has
  // been cast since, so its row still says PENDING and its PaymentIntent is still open: the reset must cancel it.
  await setClock(page, '2027-03-20T19:00:05');
  expect(await db.payment.count({ where: { state: 'PENDING' } })).toBe(1);
  const before = await db.event.findFirstOrThrow({ where: { org: { slug: 'acme' } }, select: { id: true } });
  const audits = await db.auditEvent.count();
  const users = await db.user.count();

  // No bearer, no reset.
  expect((await page.request.get('/api/cron')).status()).toBe(401);
  expect(await db.commandLog.count()).toBeGreaterThan(0);

  const res = await page.request.get('/api/cron', cron);
  expect(res.status()).toBe(200);
  const body = await res.json() as { demoReset: unknown; refunds: unknown };
  expect(body.demoReset).toEqual({ ran: true, cancelled: 1, orgs: ['acme', 'globex'] });
  expect(body.refunds).toEqual({ unsettled: 0, retryable: 0, settled: 0, stillPending: 0, needsOwner: 0, failedEvents: 0 });
  expect(JSON.stringify(body)).not.toContain('pi_'); // counts only in the answer

  // The Turnstile rows are new; nothing else moved.
  expect(await db.commandLog.count()).toBe(0);
  expect(await db.hold.count()).toBe(0);
  expect(await db.event.count()).toBe(2);
  expect(await db.event.count({ where: { id: before.id } })).toBe(0);
  expect(await db.auditEvent.count()).toBe(audits);
  expect(await db.user.count()).toBe(users);

  // What a visitor sees: the event clock at the moment sales open, everything available, in both orgs.
  await page.goto(`/o/acme/events/${EVENT}`);
  await expect(page.getByTestId('event-clock')).toHaveText(/^2026-12-01 10:0\d/);
  await expect(page.getByTestId('tier-ADV')).toContainText('400 remaining · 400 available');
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  await expect(page.getByTestId(/^hold-/)).toHaveCount(0);
  await expect(page.getByText(/^Sales (closed|open )/)).toHaveCount(0); // on sale
  await expect(page.getByTestId('used-up')).toHaveCount(0);
  await holdGa(page, 'ADV', 2); // and it sells again
  expect(await db.event.count({ where: { org: { slug: 'globex' } } })).toBe(1);

  // A second run the same night resets again (the hold just made is not a payment: nothing to cancel).
  expect((await (await page.request.get('/api/cron', cron)).json() as { demoReset: unknown }).demoReset).toEqual({ ran: true, cancelled: 0, orgs: ['acme', 'globex'] });
});
