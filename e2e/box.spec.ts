import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { castAs, EVENT, freshEvent, holdGa, paySucceeded, setClock, signIn } from './turnstile';

// Task 3.5: the box office on a freshly loaded fixture event. The waitlist shows FIFO positions with the head marked,
// and the head is the one offered; a refund preview equals, to the cent, what the cast then records.
let ids = { orgId: '', eventId: '' };
const cast = (c: Parameters<typeof castAs>[1]) => castAs(ids, c);
const cents = (s: string) => Number(s.replace(/[$,.]/g, ''));

test.beforeAll(async () => { ids = await freshEvent('box.spec'); });
test.afterAll(() => db.$disconnect());

test('waitlist head is marked and offered; refund preview equals the recorded refund', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');

  // An order to refund later: C-0001 buys two ADV (3,499 ¢ + 350 ¢ fee each).
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  const bought = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${bought}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText('OK PAYING');
  expect(await paySucceeded(page, ids, bought)).toMatchObject({ code: 'CONFIRMED' });

  // EARLY's 200 allotment held by 25 carts of 8, so joining its waitlist is allowed.
  for (let i = 0; i < 25; i++) expect((await cast({ kind: 'HOLD', customer: `C-${String(100 + i).padStart(4, '0')}`, ref: `H-E2E${i}`, tier_id: 'EARLY', qty: 8 })).code).toBe('HELD');
  for (const [who, qty] of [['C-0002', 2], ['C-0003', 1]] as const) {
    await page.goto(`/o/acme/events/${EVENT}/buy?as=${who}`);
    await page.locator('select[name="target"]').selectOption('EARLY');
    await page.getByRole('spinbutton', { name: 'Quantity' }).nth(1).fill(String(qty));
    await page.getByRole('button', { name: 'Join waitlist' }).click();
    await expect(page.getByTestId('result')).toContainText('OK WAITLISTED');
  }

  await page.goto(`/o/acme/events/${EVENT}/box`);
  const early = page.getByTestId('waitlist-EARLY');
  await expect(early.locator('tbody tr')).toHaveCount(2);
  await expect(early.locator('tbody tr').nth(0)).toContainText(/^1 head.*C-0002/);
  await expect(early.locator('tbody tr').nth(1)).toContainText(/^2.*C-0003/);
  await expect(page.getByRole('button', { name: /skip/i })).toHaveCount(0);

  // A cart is released: the head is offered first, and pays the offer from the Buy screen.
  expect((await cast({ kind: 'RELEASE', customer: 'C-0100', ref: 'H-E2E0' })).code).toBe('RELEASED');
  await page.reload();
  await expect(early.locator('tbody tr').filter({ hasText: 'C-0002' })).toContainText('offered');
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0002`);
  const offer = page.locator('[data-testid^="hold-"]').filter({ hasText: 'Waitlist offer' });
  await offer.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText('OK PAYING');

  // Ten days before the start the window is 50 %, fee kept: 3,499 → 1,749 a ticket, the odd cent stays with the venue.
  await setClock(page, '2027-03-10T12:00:01');
  await page.goto(`/o/acme/events/${EVENT}/box`);
  const pick = page.locator('select[name="order"] option', { hasText: 'C-0001' });
  await page.locator('select[name="order"]').selectOption((await pick.getAttribute('value'))!);
  await page.getByRole('button', { name: 'Open order' }).click();
  for (const box of await page.locator('input[name="t"]').all()) await box.check();
  await page.getByRole('button', { name: 'Preview refund' }).click();
  await expect(page.getByTestId('preview')).toContainText('10 days before the start, so the window is 50% of the price, fee kept');
  const previewed = cents((await page.getByTestId('preview-total').textContent())!);
  expect(previewed).toBe(3498);

  await page.getByRole('button', { name: /^Refund \$/ }).click();
  await expect(page.getByTestId('result')).toContainText('OK REFUNDED');
  const recorded = Number((await page.getByTestId('result').textContent())!.match(/ (\d+) bps=/)![1]);
  expect(recorded).toBe(previewed);
  const rows = await db.refund.aggregate({ where: { eventId: ids.eventId, reason: { startsWith: 'CUSTOMER_' } }, _sum: { amountCents: true } });
  expect(rows._sum.amountCents).toBe(previewed);
});
