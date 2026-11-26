import { expect, test, type Page } from '@playwright/test';
import { db } from '@/core/db';
import { EVENT, freshEvent } from './turnstile';

// PRD-2 item 5 (D-65): the event clock for a role without `org.update`. Before this a member saw the same Set clock
// form as the owner, and pressing it replaced the whole org layout with "Something went wrong" (HTTP 500).
//   1. A member's Event page offers no Set clock form and says who can move the clock.
//   2. The action itself refuses a member inline. The member's page no longer holds the form, so the post is made the
//      way it can still really happen: a tab that rendered the form for an owner, submitted after the browser's
//      session has become a member's. Same request a hand-built post would make, with the member's cookie.
// The sentence as the screen shows it. Written out here, not imported: `@/checkout/refusal` reaches `next/navigation`
// through the guard, which Playwright's loader cannot resolve (F-08). tests/checkout/event-clock.test.ts pins the constant.
const CLOCK_MOVERS = 'Only the organisation’s owner or an admin can move the event clock.';

test.beforeAll(async () => { await freshEvent('event-clock.spec'); });
test.afterAll(() => db.$disconnect());

const demoSignIn = async (page: Page, email: string) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: email }).click();
  await expect(page.getByRole('heading', { name: 'Your orgs' })).toBeVisible();
};
const orgBar = (page: Page) => page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Audit log' }) });

test('a member sees the clock, no Set clock form, and one sentence saying who can move it', async ({ page }) => {
  await demoSignIn(page, 'member@acme.demo.test');
  await page.goto(`/o/acme/events/${EVENT}`);
  await expect(page.getByRole('heading', { name: 'Event clock' })).toBeVisible();
  await expect(page.getByTestId('event-clock')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d/);
  await expect(page.getByTestId('clock-movers')).toHaveText(CLOCK_MOVERS);
  await expect(page.getByText(CLOCK_MOVERS)).toHaveCount(1);
  await expect(page.getByLabel('Set the event clock to')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set clock' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to the wall clock' })).toHaveCount(0);
  await expect(page.locator('input[name="to"], input[name="reset"]')).toHaveCount(0); // no clock form of any kind, active or hidden
});

for (const email of ['owner@acme.demo.test', 'admin@acme.demo.test']) {
  test(`${email} still has the Set clock form and not the member's sentence`, async ({ page }) => {
    await demoSignIn(page, email);
    await page.goto(`/o/acme/events/${EVENT}`);
    await expect(page.getByLabel('Set the event clock to')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set clock' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Back to the wall clock' })).toBeEnabled();
    await expect(page.getByTestId('clock-movers')).toHaveCount(0);
  });
}

test('a member who posts Set clock anyway is refused inline: the org bar stays and nothing answers 500', async ({ context, page }) => {
  await demoSignIn(page, 'owner@acme.demo.test');
  await page.goto(`/o/acme/events/${EVENT}`);
  await expect(page.getByRole('button', { name: 'Set clock' })).toBeVisible();
  const before = (await page.getByTestId('event-clock').textContent())!;
  const audits = () => db.auditEvent.count({ where: { action: 'event.clock_set' } });
  const auditsBefore = await audits();

  // The same browser signs in as the member in a second tab; the first tab still shows the owner's form.
  const other = await context.newPage();
  await demoSignIn(other, 'member@acme.demo.test');
  await other.goto(`/o/acme/events/${EVENT}`);
  await expect(other.getByTestId('clock-movers')).toBeVisible(); // the session is the member's now
  await other.close();

  const statuses: number[] = [];
  const posts: number[] = [];
  page.on('response', (r) => {
    statuses.push(r.status());
    if (r.request().method() === 'POST') posts.push(r.status());
  });
  for (const press of ['Set clock', 'Back to the wall clock']) {
    if (press === 'Set clock') await page.getByLabel('Set the event clock to').fill('2027-03-20T19:00:05');
    await page.getByRole('button', { name: press }).click();
    // The refusal of THIS press, in the form that was pressed: each ActionForm shows its own alert, and the first
    // form's alert is still on the page when the second button is pressed. A page-wide locator matched the first
    // alert at once (so the second press was not really checked) or, when the second had rendered, both (strict-mode
    // failure, seen once in a full local run on 2026-11-26).
    await expect(page.locator('form').filter({ has: page.getByRole('button', { name: press }) }).getByRole('alert')).toHaveText(CLOCK_MOVERS);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.getByText(/^Error id:/)).toHaveCount(0);
    await expect(orgBar(page)).toContainText('Acme Studio');
    await expect(page.getByRole('navigation', { name: 'Event screens' })).toBeVisible();
    await expect(page).toHaveTitle('Event · Turnstile');
    await expect(page).toHaveURL(new RegExp(`/o/acme/events/${EVENT}$`));
  }
  expect(posts).toHaveLength(2); // each press was a real post to the action
  expect(posts.every((s) => s === 200)).toBe(true);
  expect(statuses.filter((s) => s >= 500)).toEqual([]);

  // Nothing moved: the clock is not at show night (it is still in 2026, where the fresh event's wall clock is), and no
  // audit line was written. The audit count is what proves the "Back to the wall clock" press did nothing.
  await page.reload();
  await expect(page.getByTestId('clock-movers')).toBeVisible();
  await expect(page.getByTestId('event-clock')).toHaveText(new RegExp(`^${before.slice(0, 4)}-`));
  await expect(page.getByTestId('event-clock')).not.toHaveText(/^2027-03-20/);
  expect(await audits()).toBe(auditsBefore);
});
