import { expect, test } from '@playwright/test';
import { db } from '@/core/db';
import { EVENT, freshEvent, setClock, signIn } from './turnstile';

// PRD-4 item 15 (DES-2, A11Y-4): at 390 the 12 seats of a row share one line inside the section's focusable scroll
// region (the page itself does not scroll sideways), every seat keeps a 44 px target, and each seat's accessible name
// starts with its visible number (WCAG 2.5.3).
test.beforeAll(async () => { await freshEvent('prd4-seats.spec'); });
test.afterAll(() => db.$disconnect());

for (const width of [390, 1280]) {
  test(`at ${width} px each row of 12 is one line; seat names start with the visible number`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await setClock(page, '2026-12-01T10:05:30');
    await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001#seats`);
    const region = page.getByRole('region', { name: 'Section A rows' });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('tabindex', '0');

    const rows = await page.locator('.seats').evaluateAll((groups) => groups.map((g) => {
      const seats = [...g.querySelectorAll('label.seat')].map((l) => l.getBoundingClientRect());
      return { n: seats.length, tops: new Set(seats.map((r) => Math.round(r.top))).size, minW: Math.min(...seats.map((r) => r.width)), minH: Math.min(...seats.map((r) => r.height)) };
    }));
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r).toEqual({ n: 12, tops: 1, minW: 44, minH: 44 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways page scroll').toBeLessThanOrEqual(width);
    if (width === 390) {
      // the rows are wider than the card: the region scrolls, and a keyboard user can scroll it
      expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await region.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }

    // accessible name = visible number first, then seat id and state (the context the group label also gives)
    const names = await page.locator('label.seat').evaluateAll((ls) => ls.slice(0, 13).map((l) => ({ visible: l.textContent!.trim(), name: l.querySelector('input')!.getAttribute('aria-label')! })));
    for (const { visible, name } of names) expect(name.startsWith(`${visible},`), `${name} starts with ${visible}`).toBe(true);
    await expect(page.getByRole('checkbox', { name: '1, A-A-01 open', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '12, A-A-12 open', exact: true })).toBeAttached();
  });
}
