import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Template port (see ~/.claude/CLAUDE.md port table). Clones get their own via new-project.
const PORT = Number(process.env.PORT ?? 7700);
// Turnstile's specs post webhooks signed with the fixture secret, published on purpose (D-5); the server under test
// gets that secret and no Stripe key, so payStart answers from StripeRecorded even where .env.local holds a test key.
const FIXTURE_WEBHOOK_SECRET = (JSON.parse(readFileSync('fixtures/stripe/webhook.json', 'utf8')) as { secret: string }).secret;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // the Turnstile specs each reset the Turnstile tables; two files at once would wipe each other's event
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: process.env.E2E_DEV ? 'npm run dev:test' : 'npm run e2e:server',
    url: `http://localhost:${PORT}/api/health`,
    env: { DEMO_MODE: '1', SSO_ENABLED: '1', STRIPE_WEBHOOK_SECRET: FIXTURE_WEBHOOK_SECRET, STRIPE_SECRET_KEY: '', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '' }, // demo.spec drives /demo; sso.spec the sso module
    reuseExistingServer: false, // a stale server on this port would test the wrong app
    timeout: 300_000, // a cold production build outruns the 120s default
  },
});
