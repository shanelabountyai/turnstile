import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { expectAccessible } from './axe';
import { EVENT, freshEvent, signIn } from './turnstile';

// PRD-4 item 14 (D-63; UX-7, DES-3, A11Y-3): the org home with a loaded event shows it under a PageHeader with a link
// to it, its <main> is the skip link's target, and axe finds nothing in light and dark at 1280 and 390. An org with no
// event keeps the template's "Nothing here yet" (onboarding.spec, unchanged, asserts that for a new org). The last test
// empties the Turnstile tables; this file runs on a *_test database only (freshEvent checks).
test.use({ bypassCSP: true }); // axe is injected; the app's CSP (INV-15) rightly refuses that
test.beforeAll(async () => { await freshEvent('prd4-org-home.spec'); });
test.afterAll(() => db.$disconnect());

for (const width of [1280, 390]) {
  test(`/o/acme at ${width} px: the event card, the skip link lands on main, axe 0 in light and dark`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto('/o/acme');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acme Studio');
    await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toHaveCount(0);
    const card = page.getByTestId(`home-event-${EVENT}`);
    await expect(card.getByRole('link', { name: 'Open event' })).toHaveAttribute('href', `/o/acme/events/${EVENT}`);
    await expect(card.getByRole('heading', { level: 2 }).getByRole('link')).toHaveAttribute('href', `/o/acme/events/${EVENT}`);
    await expect(page.locator('main#main')).toHaveCount(1);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);

    await expectAccessible(page, `org home (${width} px)`, 'Open event');
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways page scroll').toBeLessThanOrEqual(width);

    await card.getByRole('link', { name: 'Open event' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/acme/events/${EVENT}$`));
  });
}

test('an org with no event keeps the template text, now with id="main"', async ({ page }) => {
  await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
  await signIn(page);
  await page.goto('/o/acme');
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing here yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invite your team' })).toBeVisible();
  await expect(page.locator('main#main')).toHaveCount(1);
});
