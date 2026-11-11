import { expect, test, type Page } from '@playwright/test';
import { db } from '@/core/db';
import { castAs, EVENT, freshEvent, holdGa, paySucceeded, setClock, signIn } from './turnstile';

// Task 3.6: the door on a freshly loaded fixture event. Two tickets bought, one refunded; then every answer a scan can
// give (D-18), each spelled out, and the live count moving on the one success.
let ids = { orgId: '', eventId: '' };
test.beforeAll(async () => { ids = await freshEvent('door.spec'); });
test.afterAll(() => db.$disconnect());

async function scan(page: Page, code: string) {
  await page.getByLabel('Ticket code').fill(code);
  await page.getByRole('button', { name: 'Check in' }).click();
  return page.getByTestId('result');
}

test('door: DOORS_NOT_OPEN, TICKET_REFUNDED, CHECKED_IN, ALREADY_CHECKED_IN with the first scan time, TICKET_UNKNOWN', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  const hold = await holdGa(page, 'ADV', 2);
  await page.getByTestId(`hold-${hold}`).getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByTestId('result')).toContainText('OK PAYING');
  expect(await paySucceeded(page, ids, hold)).toMatchObject({ code: 'CONFIRMED' });
  const [good, gone] = await db.ticket.findMany({ where: { eventId: ids.eventId }, orderBy: { ticketId: 'asc' }, select: { ticketId: true, orderId: true, code: true } });
  expect((await castAs(ids, { kind: 'REFUND_REQUEST', customer: 'C-0001', ref: gone!.orderId, tickets: [gone!.ticketId] })).code).toBe('REFUNDED');

  await page.goto(`/o/acme/events/${EVENT}/door`);
  await expect(await scan(page, good!.code)).toContainText('Doors are not open yet; they open at 2027-03-20 19:00:00');

  await setClock(page, '2027-03-20T19:00:05');
  await page.goto(`/o/acme/events/${EVENT}/door`);
  await expect(page.getByTestId('live')).toHaveText('1');
  await expect(page.getByTestId('checked-in')).toHaveText('0');

  await expect(await scan(page, gone!.code)).toContainText(`Ticket ${gone!.ticketId} was refunded`);
  const ok = await scan(page, good!.code);
  await expect(ok).toContainText(`Admit. Ticket ${good!.ticketId} is checked in.`);
  const first = (await ok.textContent())!.match(/at (\S+ \S+)$/)![1];
  await expect(page.getByTestId('checked-in')).toHaveText('1');
  await expect(await scan(page, good!.code)).toContainText(`first checked in at ${first}`);
  await expect(await scan(page, 'not-a-real-code')).toContainText('No ticket for this event matches “not-a-real-code”');
  await expect(page.getByTestId('checked-in')).toHaveText('1');
});
