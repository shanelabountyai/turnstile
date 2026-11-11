// The ONE accessibility check every Turnstile spec goes through (a check written per spec ends up
// light-only; the loop over both colour schemes lives here so no call site can forget dark). axe-core comes from the
// lockfile (it is already installed as a dependency of eslint-plugin-jsx-a11y); @axe-core/playwright is not added
// (no new dependencies). The page's CSP refuses injected scripts, so specs that call this run with bypassCSP.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

/**
 * axe on the current page in light AND dark. `mustSee` is the premise: text that proves the page measured is the
 * page meant (a green run over the login page looks exactly like a green run). Prints the URL it measured.
 */
export async function expectAccessible(page: Page, what: string, mustSee: string | RegExp) {
  await expect(page.getByText(mustSee).first(), `${what}: premise — is this the page meant? (${page.url()})`).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const hasAxe = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== 'undefined');
    if (!hasAxe) await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: Violation[] }> } }).axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
    });
    console.log(`axe ${scheme.padEnd(5)} ${violations.length} violations — ${what} — ${page.url()}`);
    expect(violations, `${what} [${scheme}] at ${page.url()}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
