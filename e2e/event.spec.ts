import { expect, test } from '@playwright/test';
import { loadFixtureEvent } from '@/checkout/load';
import { db } from '@/core/db';
import { castFixture } from '../scripts/cast-fixture';
import { seedDemo } from '../scripts/seed-demo';

// Task 3.3: the event screen on the loaded fixture, cast to its end state (the 2,662 commands, Stripe recorded).
test.beforeAll(async () => {
  test.setTimeout(300_000); // the full cast is ~35 s locally, slower on a runner
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) throw new Error('event.spec empties Turnstile rows; run it against a *_test database');
  await seedDemo();
  await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
  const acme = await db.org.findUniqueOrThrow({ where: { slug: 'acme' }, select: { id: true } });
  const { eventId } = await loadFixtureEvent(acme.id, 'fixtures');
  await castFixture(acme.id, eventId);
});
test.afterAll(() => db.$disconnect());

test('Door reads pool sold out, not tier sold out; BALC still sells', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.goto('/o/acme/events');
  await page.getByRole('link', { name: 'Synthetic Night (fixture)' }).click();

  const door = page.getByTestId('tier-DOOR');
  await expect(door).toHaveText('87 remaining · 0 available — pool sold out');
  await expect(door).toHaveAttribute('title', /min\(tier remaining 87, pool remaining 0\) = 0/);
  await expect(page.getByTestId('tier-BALC')).toHaveText('12 remaining · 12 available');
  await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Refund windows' })).toContainText('50%');
});
