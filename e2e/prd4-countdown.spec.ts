import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { EVENT, freshEvent, holdGa, setClock, signIn } from './turnstile';

// PRD-4 item 16 (A11Y-2): the countdown's spoken warning names the hold once ("Two minutes or less left on H-…", not
// "… left on time left on H-…"), and the zero message is still in the page's live region after the refresh has moved
// the expired hold out of the list. The browser's timers run on Playwright's clock; the server's hold expiry is moved
// by the event clock (D-35), the same way buy.spec does it.
test.beforeAll(async () => { await freshEvent('prd4-countdown.spec'); });
test.afterAll(() => db.$disconnect());

test('two minutes, then zero: one region, the hold id once, and it survives the refresh', async ({ page }) => {
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  await page.clock.install();
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0003`);
  const hold = await holdGa(page, 'ADV', 1);
  const voice = page.getByTestId('countdown-voice');
  await expect(voice).toHaveText('');
  await expect(page.locator('[aria-live]').filter({ hasText: 'Two minutes' })).toHaveCount(0);

  await page.clock.runFor('08:05'); // a 10-minute hold: 1:55 left
  await expect(voice).toHaveText(`Two minutes or less left on ${hold}.`);
  await expect(page.locator('[aria-live]').filter({ hasText: 'Two minutes' })).toHaveCount(1); // one region, not one per hold
  await expect(page.getByText(/time left on/)).toHaveCount(0);

  // The server's clock passes the hold's expiry (in a second tab), then the page's countdown reaches zero and refreshes.
  const tab = await page.context().newPage();
  await setClock(tab, '2026-12-01T10:30:30');
  await tab.close();
  await page.clock.runFor('02:00');
  await expect(page.getByTestId(`hold-${hold}`)).toContainText('HOLD_EXPIRED'); // the refresh moved it to the ended list
  await expect(page.getByTestId(`hold-${hold}`).getByRole('timer')).toHaveCount(0);
  await expect(voice).toHaveText(`Time is up on ${hold}.`);
});
