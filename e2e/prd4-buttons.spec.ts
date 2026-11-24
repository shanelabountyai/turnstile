import { expect, test, type Page } from '@playwright/test';
import { db } from '@/core/db';
import { EVENT, freshEvent, setClock, signIn } from './turnstile';

// PRD-4 item 13 (DES-1): in every `.cluster` form at 1280, a button that shares a row with a field sits on the field's
// bottom edge (within 1 px), measured from Playwright bounding boxes. Before the fix the base button rule's
// `align-self: flex-start` beat the cluster's `align-items: flex-end`, so the button sat at the label's height.
test.beforeAll(async () => { await freshEvent('prd4-buttons.spec'); });
test.afterAll(() => db.$disconnect());

type Pair = { button: string; buttonBottom: number; fieldBottom: number; wrapped: boolean };

/** Every `.cluster` with a direct `label` (holding an input or select) and a direct button: the two bottom edges. */
const pairs = (page: Page) => page.evaluate(() => {
  const out: Pair[] = [];
  for (const c of document.querySelectorAll('.cluster')) {
    const kids = [...c.children] as HTMLElement[];
    const fields = kids.filter((k) => k.tagName === 'LABEL').map((l) => l.querySelector('input:not([type=hidden]), select')).filter(Boolean) as HTMLElement[];
    const buttons = kids.filter((k) => k.tagName === 'BUTTON' || k.classList.contains('button'));
    for (const b of buttons) for (const f of fields) {
      if (b.offsetParent === null) continue;
      const br = b.getBoundingClientRect(); const fr = f.getBoundingClientRect();
      // wrapped onto a line of its own (it depends on the fonts: CI's wrap where this sandbox's do not): not the same row
      out.push({ button: b.textContent!.trim(), buttonBottom: br.bottom, fieldBottom: fr.bottom, wrapped: br.top >= fr.bottom });
    }
  }
  return out;
});

test('at 1280 every cluster button sits on its field\'s bottom edge (Event, Buy, Box office)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await setClock(page, '2026-12-01T10:05:30');
  const seen: string[] = [];
  const aligned: string[] = [];
  for (const path of [`/o/acme/events/${EVENT}`, `/o/acme/events/${EVENT}/buy`, `/o/acme/events/${EVENT}/buy?as=C-0001`, `/o/acme/events/${EVENT}/box`]) {
    await page.goto(path);
    for (const p of await pairs(page)) {
      seen.push(p.button);
      if (p.wrapped) continue;
      aligned.push(p.button);
      expect(Math.abs(p.buttonBottom - p.fieldBottom), `${path}: "${p.button}" bottom ${p.buttonBottom} vs field ${p.fieldBottom}`).toBeLessThanOrEqual(1);
    }
  }
  // premise: every form the review names was found beside its field, and at least four of them share a row with it
  // (a button that wraps onto its own line is not misaligned, and which ones wrap depends on the fonts)
  for (const b of ['Set clock', 'Act as', 'Hold tickets', 'Join the Section A waitlist', 'Join waitlist', 'Pick balcony seats as this customer', 'Open order']) expect(seen).toContain(b);
  expect(new Set(aligned).size, `measured on one row: ${[...new Set(aligned)].join(', ')}`).toBeGreaterThanOrEqual(4);
});

test('the seat fieldset keeps a gap between the last row and "Hold seats"', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto(`/o/acme/events/${EVENT}/buy?as=C-0001`);
  const gap = await page.evaluate(() => {
    const fs = document.querySelector('fieldset.plain')!;
    const rows = fs.querySelector('.seat-rows')!.getBoundingClientRect();
    const btn = fs.querySelector('button')!.getBoundingClientRect();
    return { gap: btn.top - rows.bottom, style: getComputedStyle(fs).rowGap };
  });
  expect(gap.style).toBe('12px'); // var(--s-3)
  expect(gap.gap).toBeGreaterThanOrEqual(12);
});
