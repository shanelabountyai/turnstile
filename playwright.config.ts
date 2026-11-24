import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Template port (see ~/.claude/CLAUDE.md port table). Clones get their own via new-project.
const PORT = Number(process.env.PORT ?? 7700);
// Turnstile's specs post webhooks signed with the fixture secret, published on purpose (D-5); the server under test
// gets that secret and no Stripe key, so payStart answers from StripeRecorded even where .env.local holds a test key.
const FIXTURE_WEBHOOK_SECRET = (JSON.parse(readFileSync('fixtures/stripe/webhook.json', 'utf8')) as { secret: string }).secret;
// Deploy prep (D-46): `E2E_DEMO_ACCESS_PASSWORD=<any throwaway value>` runs the suite as deployed, behind the demo
// password gate (src/proxy.ts): the server gets it as DEMO_ACCESS_PASSWORD and the browser answers the Basic challenge
// with it. Unset (the default, and CI) there is no gate, as before. The value is the caller's; none is stored here.
const GATE = process.env.E2E_DEMO_ACCESS_PASSWORD;
// D-60: demo-reset.spec calls /api/cron the way Vercel Cron does, with a bearer. This is a throwaway value for the
// server under test only, published on purpose like the fixture webhook secret; it is not any deployment's CRON_SECRET.
export const E2E_CRON_SECRET = 'e2e-only-cron-bearer-not-a-real-secret';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // the Turnstile specs each reset the Turnstile tables; two files at once would wipe each other's event
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, ...(GATE && { httpCredentials: { username: 'demo', password: GATE } }) },
  webServer: {
    command: process.env.E2E_DEV ? 'npm run dev:test' : 'npm run e2e:server',
    url: `http://localhost:${PORT}/api/health`,
    env: { DEMO_MODE: '1', SSO_ENABLED: '1', CRON_SECRET: E2E_CRON_SECRET, STRIPE_WEBHOOK_SECRET: FIXTURE_WEBHOOK_SECRET, STRIPE_SECRET_KEY: '', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '', ...(GATE && { DEMO_ACCESS_PASSWORD: GATE }) }, // demo.spec drives /demo; sso.spec the sso module
    reuseExistingServer: false, // a stale server on this port would test the wrong app
    timeout: 300_000, // a cold production build outruns the 120s default
  },
});
