import { expect, test, type Page } from '@playwright/test';
import { axisNow } from '@/checkout/clock';
import { CLOCK_PAST_CLOSE, usedUpWords, WALL_CLOCK_BLOCKED } from '@/checkout/prd3-wording';
import { db } from '@/core/db';
import { EVENT, freshEvent, setClock, signIn } from './turnstile';

// PRD-3 item 9 (review UX-3, UX-4, UX-15), on the server under test, which runs in demo mode (playwright.config.ts):
// the clock move that closes sales asks first and says it is one-way; a spent org says "use globex or ask for a reset"
// on the Events card and above the customer picker on Buy; and "Back to the wall clock" is replaced by a sentence when
// it can only fail or would break the walk. Sales close at 2027-03-20 20:00:00 in the fixture event.
const CLOSE = '2027-03-20T20:00:00'; // typed into the datetime field without its :00 seconds, as a browser shows it
const USED_UP = usedUpWords('globex');
const eventPage = `/o/acme/events/${EVENT}`;
const wallNow = () => axisNow(new Date(), 'America/Chicago');

test.beforeAll(async () => { await freshEvent('demo-warnings.spec'); });
test.afterAll(() => db.$disconnect());

/** True when `a` comes before `b` in the document. */
const precedes = (page: Page, a: string, b: string) =>
  page.evaluate(([x, y]) => Boolean(document.querySelector(x!)!.compareDocumentPosition(document.querySelector(y!)!) & Node.DOCUMENT_POSITION_FOLLOWING), [a, b]);

test('the one-way clock: confirmation before sales close, the used-up line after, and when "Back to the wall clock" is off', async ({ page }) => {
  await signIn(page);

  // A fresh event is on the wall clock: the button is offered (pressing it changes nothing), and no line says the org is used up.
  await page.goto(eventPage);
  await expect(page.getByRole('button', { name: 'Back to the wall clock' })).toBeEnabled();
  await expect(page.getByTestId('wall-clock-off')).toHaveCount(0);

  // Inside the sales window, with the wall clock still before sales open: going back would leave nothing to buy.
  await setClock(page, '2026-12-01T10:05:30');
  if (wallNow() < '2026-12-01T10:00:00') {
    await expect(page.getByTestId('wall-clock-off')).toHaveText(WALL_CLOCK_BLOCKED['before-open']);
    await expect(page.getByRole('button', { name: 'Back to the wall clock' })).toHaveCount(0);
    await expect(page.locator('input[name="reset"]')).toHaveCount(0);
  }

  // Show night, before the close: no confirmation is asked for (this is the README's step 7), and nothing says "used up".
  await setClock(page, '2027-03-20T19:00:05');
  await expect(page.getByTestId('clock-confirm')).toHaveCount(0);
  await page.goto('/o/acme/events');
  await expect(page.getByTestId('used-up')).toHaveCount(0);
  await page.goto(`${eventPage}/buy`);
  await expect(page.getByTestId('used-up')).toHaveCount(0);

  // A refused hold is still a recorded command (non-negotiable 5), so the log is now ahead of the wall clock:
  // "Back to the wall clock" could only fail, and the page says so instead of offering it.
  await page.goto(`${eventPage}/buy?as=C-0001`);
  await page.getByRole('button', { name: 'Hold tickets' }).click();
  await expect(page.getByTestId('result')).toContainText('REJECT');
  await page.goto(eventPage);
  if (wallNow() < '2027-03-20T19:00:05') {
    await expect(page.getByTestId('wall-clock-off')).toHaveText(WALL_CLOCK_BLOCKED.fails);
    await expect(page.getByRole('button', { name: 'Back to the wall clock' })).toHaveCount(0);
  }

  // Setting the clock to the close of sales asks first. Nothing has moved yet.
  await page.getByLabel('Set the event clock to').fill(CLOSE.slice(0, 16));
  await page.getByRole('button', { name: 'Set clock' }).click();
  const confirm = page.getByTestId('clock-confirm');
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(/confirm_clock=2027-03-20T20(:|%3A)00(:|%3A)00/);
  await expect(confirm).toHaveAttribute('role', 'alert');
  await expect(confirm).toContainText(CLOCK_PAST_CLOSE.title);
  await expect(confirm).toContainText(CLOCK_PAST_CLOSE.body('2027-03-20 20:00:00', '2027-03-20 20:00:00'));
  await expect(confirm).toContainText(CLOCK_PAST_CLOSE.demo);
  await expect(page.getByTestId('event-clock')).toHaveText(/^2027-03-20 19:0/);
  const auditsBefore = await db.auditEvent.count({ where: { action: 'event.clock_set' } });

  // Cancel leaves the clock where it was.
  await confirm.getByRole('link', { name: CLOCK_PAST_CLOSE.cancel }).click();
  await expect(page.getByTestId('clock-confirm')).toHaveCount(0);
  await expect(page.getByTestId('event-clock')).toHaveText(/^2027-03-20 19:0/);
  expect(await db.auditEvent.count({ where: { action: 'event.clock_set' } })).toBe(auditsBefore);

  // A made-up confirm_clock that does not close sales shows no confirmation (the parameter is only a time to show back).
  await page.goto(`${eventPage}?confirm_clock=2027-03-20T19:30:00`);
  await expect(page.getByTestId('clock-confirm')).toHaveCount(0);
  await page.goto(`${eventPage}?confirm_clock=not-a-time`);
  await expect(page.getByTestId('clock-confirm')).toHaveCount(0);

  // Confirming moves it.
  await page.getByLabel('Set the event clock to').fill(CLOSE.slice(0, 16));
  await page.getByRole('button', { name: 'Set clock' }).click();
  await page.getByTestId('clock-confirm').getByRole('button', { name: CLOCK_PAST_CLOSE.confirm('2027-03-20 20:00:00') }).click();
  await expect(page).toHaveURL(new RegExp(`${EVENT}$`));
  await expect(page.getByTestId('event-clock')).toHaveText(/^2027-03-20 20:00/);
  await expect(page.getByTestId('clock-confirm')).toHaveCount(0);
  expect(await db.auditEvent.count({ where: { action: 'event.clock_set' } })).toBe(auditsBefore + 1);

  // The org is spent. The Events card says what to do next…
  await page.goto('/o/acme/events');
  await expect(page.getByText('Sales closed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('used-up')).toHaveText(USED_UP);
  await expect(page.getByTestId('used-up')).toHaveCount(1);

  // …and so does Buy, above the customer picker, before a customer is picked and after (when the picker is at the foot).
  await page.goto(`${eventPage}/buy`);
  await expect(page.getByTestId('used-up')).toHaveText(USED_UP);
  expect(await precedes(page, '[data-testid="used-up"]', 'select[name="as"]')).toBe(true);
  await page.goto(`${eventPage}/buy?as=C-0001`);
  await expect(page.getByTestId('used-up')).toHaveText(USED_UP);
  expect(await precedes(page, '[data-testid="used-up"]', 'select[name="as"]')).toBe(true);
  await expect(page.getByText('Sales closed', { exact: true })).toBeVisible();

  // Past the close, a later time needs no second confirmation.
  await page.goto(eventPage);
  await page.getByLabel('Set the event clock to').fill('2027-03-20T20:30');
  await page.getByRole('button', { name: 'Set clock' }).click();
  await expect(page.getByTestId('event-clock')).toHaveText(/^2027-03-20 20:30/);
  await expect(page.getByTestId('clock-confirm')).toHaveCount(0);
});

test('a member is still not offered any clock control, with or without a confirm_clock in the URL (PRD-2 item 5 unchanged)', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'member@acme.demo.test' }).click();
  await page.goto(`${eventPage}?confirm_clock=2027-03-21T09:00:00`);
  await expect(page.getByTestId('clock-movers')).toBeVisible();
  await expect(page.getByTestId('clock-confirm')).toHaveCount(0);
  await expect(page.getByTestId('wall-clock-off')).toHaveCount(0);
  await expect(page.locator('input[name="to"], input[name="reset"], input[name="confirm"]')).toHaveCount(0);
});
