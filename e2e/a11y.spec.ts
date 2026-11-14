import { test } from '@playwright/test';
import { loadFixtureEvent } from '@/checkout/load';
import { db } from '@/core/db';
import { castFixture } from '../scripts/cast-fixture';
import { seedDemo } from '../scripts/seed-demo';
import { expectAccessible } from './axe';
import { EVENT, signIn } from './turnstile';

// Task 3.9: axe in light and dark on every Turnstile page, over the cast end state (every component has content).
test.use({ bypassCSP: true }); // axe is injected; the app's CSP (INV-15) rightly refuses that
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) throw new Error('a11y.spec empties Turnstile rows; run it against a *_test database');
  await seedDemo();
  await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
  const acme = await db.org.findUniqueOrThrow({ where: { slug: 'acme' }, select: { id: true } });
  const { eventId } = await loadFixtureEvent(acme.id, 'fixtures');
  await castFixture(acme.id, eventId);
});
test.afterAll(() => db.$disconnect());

const base = `/o/acme/events/${EVENT}`;
const pages: [string, string, string | RegExp][] = [
  ['design system', '/o/acme/design', 'Turnstile design system'],
  ['events list', '/o/acme/events', 'All events'],
  ['event', base, 'Rules'],
  ['buy', `${base}/buy?as=C-0001`, /Event clock/],
  ['box office', `${base}/box`, /Event clock/],
  ['door', `${base}/door`, /Event clock/],
  ['ledger', `${base}/ledger`, /Event clock/],
];

for (const [what, path, mustSee] of pages) {
  test(`axe, light and dark: ${what}`, async ({ page }) => {
    await signIn(page);
    await page.goto(path);
    await expectAccessible(page, what, mustSee);
  });
}
