import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { castCommand } from '@/checkout/cast';
import { loadFixtureEvent } from '@/checkout/load';
import { signStripePayload } from '@/checkout/webhook';
import { db } from '@/core/db';
import type { Command } from '@/inventory/types';
import { seedDemo } from '../scripts/seed-demo';

// Shared by the Turnstile screen specs: a freshly loaded fixture event in the acme org (no commands cast), the event
// clock (D-35), a GA hold on the Buy screen, and the success webhook posted the way Stripe would (fixture secret).
export const EVENT = 'EV-SYNTH-001';
const SECRET = (JSON.parse(readFileSync('fixtures/stripe/webhook.json', 'utf8')) as { secret: string }).secret;

export async function freshEvent(spec: string): Promise<{ orgId: string; eventId: string }> {
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) throw new Error(`${spec} empties Turnstile rows; run it against a *_test database`);
  await seedDemo();
  await db.$executeRawUnsafe('TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer"');
  const orgId = (await db.org.findUniqueOrThrow({ where: { slug: 'acme' }, select: { id: true } })).id;
  return { orgId, eventId: (await loadFixtureEvent(orgId, 'fixtures')).eventId };
}

export async function signIn(page: Page) {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
}

export async function setClock(page: Page, to: string) {
  await page.goto(`/o/acme/events/${EVENT}`);
  await page.getByLabel('Set the event clock to').fill(to);
  await page.getByRole('button', { name: 'Set clock' }).click();
  await expect(page.getByTestId('event-clock')).toHaveText(new RegExp(`^${to.slice(0, 16).replace('T', ' ')}`));
}

export async function holdGa(page: Page, tier: string, qty: number): Promise<string> {
  await page.locator('select[name="tier"]').selectOption(tier);
  await page.getByRole('spinbutton', { name: 'Quantity' }).first().fill(String(qty));
  await page.getByRole('button', { name: 'Hold tickets' }).click();
  await expect(page.getByTestId('result')).toContainText('OK HELD');
  return (await page.getByTestId('result').textContent())!.match(/H-[0-9A-F]{8}/)![0];
}

export async function paySucceeded(page: Page, ids: { orgId: string; eventId: string }, hold: string) {
  const body = JSON.stringify({
    id: `evt_e2e_${hold}`, object: 'event', type: 'payment_intent.succeeded',
    data: { object: { id: `pi_rec_${hold}`, object: 'payment_intent', metadata: { hold_id: hold, org_id: ids.orgId, event_id: ids.eventId } } },
  });
  const res = await page.request.post('/api/checkout/webhook', { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(body, SECRET, Math.floor(Date.now() / 1000)) } });
  expect(res.status()).toBe(200);
  return res.json();
}

/** One command straight through the cast path, stamped on the event clock (D-35): setup a spec does not need a screen for. */
export const castAs = (ids: { orgId: string; eventId: string }, c: Partial<Command> & Pick<Command, 'kind' | 'customer'>) => castCommand(ids.orgId, ids.eventId, {
  cmd_id: `E2E-${crypto.randomUUID()}`, at: '2026-12-01T10:00:00', ref: '', tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: [], note: 'e2e', ...c,
}, { clock: new Date() });
