import { expect, test } from '@playwright/test';
import { dollars } from '@/checkout/read';
import { db } from '@/core/db';
import { castAs, EVENT, freshEvent, holdGa, paySucceeded, setClock, signIn } from './turnstile';

// Task 3.7: one paid order, one ticket refunded; the page's captured/refunded/net and the CSV's columns are the same
// numbers, and the CSV sums to the page.
let ids = { orgId: '', eventId: '' };
test.beforeAll(async () => { ids = await freshEvent('ledger.spec'); });
test.afterAll(() => db.$disconnect());

test('ledger: page totals = CSV column sums after a sale and a partial refund', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  const hold = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText('OK PAYING');
  expect(await paySucceeded(page, ids, hold)).toMatchObject({ code: 'CONFIRMED' });
  const t = await db.ticket.findFirstOrThrow({ where: { eventId: ids.eventId }, orderBy: { ticketId: 'desc' }, select: { ticketId: true, orderId: true } });
  expect((await castAs(ids, { kind: 'REFUND_REQUEST', customer: 'C-0001', ref: t.orderId, tickets: [t.ticketId] })).code).toBe('REFUNDED');

  await page.goto(`/o/acme/events/${EVENT}/ledger`);
  const csv = await (await page.request.get(`/o/acme/events/${EVENT}/ledger/csv`)).text();
  const [head, ...lines] = csv.trim().split('\r\n').map((l) => l.split(','));
  const sum = (k: string) => lines.reduce((n, l) => n + Number(l[head!.indexOf(k)]), 0);
  expect(lines).toHaveLength(1);
  expect(sum('refunded_cents')).toBeGreaterThan(0);
  expect(sum('captured_cents') - sum('refunded_cents')).toBe(sum('net_cents'));
  await expect(page.getByTestId('captured')).toHaveText(dollars(sum('captured_cents')));
  await expect(page.getByTestId('refunded')).toHaveText(dollars(sum('refunded_cents')));
  await expect(page.getByTestId('net')).toHaveText(dollars(sum('net_cents')));
});
