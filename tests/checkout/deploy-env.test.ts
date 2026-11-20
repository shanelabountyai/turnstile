// D-45: the Production build's environment check. Every value below is made up in this file and shaped only as far as
// the check looks (a prefix); none is a real key, and no real key is ever read here.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deployProblems, turnstileProblems } from '../../scripts/deploy-env';

const filler = 'x'.repeat(40);
// Published on purpose for CI (D-5); a production deployment must never accept webhooks signed with it.
const FIXTURE_SECRET = (JSON.parse(readFileSync('fixtures/stripe/webhook.json', 'utf8')) as { secret: string }).secret;
const good: Record<string, string> = {
  VERCEL: '1', VERCEL_ENV: 'production',
  DATABASE_URL: 'postgresql://owner@db.invalid/turnstile', MIGRATE_URL: 'postgresql://owner@db-direct.invalid/turnstile',
  AUTH_SECRET: filler, APP_URL: 'https://turnstile.invalid', EMAIL_ENABLED: '0',
  DEMO_MODE: '1', DEMO_ACCESS_PASSWORD: filler, CRON_SECRET: filler,
  STRIPE_SECRET_KEY: `sk_test_${filler}`, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: `pk_test_${filler}`, STRIPE_WEBHOOK_SECRET: `whsec_${filler}`,
};
const without = (...names: string[]) => Object.fromEntries(Object.entries(good).filter(([k]) => !names.includes(k)));
const names = (problems: string[]) => problems.map((p) => p.split(':')[0]);
// The script as the build runs it, with exactly the environment given (nothing inherited but PATH and HOME).
const script = (env: Record<string, string>) =>
  spawnSync('npx', ['tsx', 'scripts/deploy-env.ts'], { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });

describe('deploy-env: a Production build is refused with a list of names (D-45)', () => {
  it('passes the complete set of 11', async () => {
    expect(await deployProblems(good)).toEqual([]);
    expect(Object.keys(good).filter((k) => !k.startsWith('VERCEL'))).toHaveLength(11);
  });

  it('names each missing variable, one line each, and reports them all at once', async () => {
    for (const n of ['MIGRATE_URL', 'DEMO_ACCESS_PASSWORD', 'CRON_SECRET', 'DEMO_MODE', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'])
      expect(names(turnstileProblems(without(n)))).toEqual([n]);
    expect(names(turnstileProblems({}))).toEqual(['MIGRATE_URL', 'DEMO_ACCESS_PASSWORD', 'CRON_SECRET', 'DEMO_MODE', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET']);
    expect(names(turnstileProblems({ ...good, STRIPE_WEBHOOK_SECRET: '' }))).toEqual(['STRIPE_WEBHOOK_SECRET']); // an empty value is unset
  });

  it('carries the core schema’s own verdict: the three it always needs, and email off or configured in production', async () => {
    expect(await deployProblems(without('DATABASE_URL', 'AUTH_SECRET', 'APP_URL'))).toEqual(['core schema (src/core/env.ts): DATABASE_URL, AUTH_SECRET, APP_URL']);
    expect(await deployProblems(without('EMAIL_ENABLED'))).toEqual(['core schema (src/core/env.ts): RESEND_API_KEY, EMAIL_FROM (required in production)']);
  });

  it('refuses a live Stripe key, a mismatched publishable key and the published fixture signing secret', () => {
    expect(names(turnstileProblems({ ...good, STRIPE_SECRET_KEY: `sk_live_${filler}` }))).toEqual(['STRIPE_SECRET_KEY']);
    expect(names(turnstileProblems({ ...good, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: `pk_live_${filler}` }))).toEqual(['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']);
    expect(names(turnstileProblems({ ...good, STRIPE_WEBHOOK_SECRET: FIXTURE_SECRET }))).toEqual(['STRIPE_WEBHOOK_SECRET']);
    expect(turnstileProblems({ ...good, STRIPE_SECRET_KEY: `rk_test_${filler}` })).toEqual([]); // a restricted test key is fine
  });

  it('refuses an APP_URL that is localhost, http, or carries a path', () => {
    for (const u of ['http://localhost:7700', 'https://localhost', 'http://turnstile.invalid', 'https://turnstile.invalid/', 'https://turnstile.invalid/demo'])
      expect(names(turnstileProblems({ ...good, APP_URL: u }))).toEqual(['APP_URL']);
  });

  it('DEMO_MODE may be off only where email sign-in is configured', () => {
    expect(turnstileProblems({ ...without('DEMO_MODE', 'EMAIL_ENABLED'), RESEND_API_KEY: filler, EMAIL_FROM: 'Turnstile <no-reply@turnstile.invalid>' })).toEqual([]);
  });

  it('never prints a value: the script exits 1 naming names, and the output holds none of the values it was given', () => {
    const marker = `leak-${filler}`;
    const r = script({ ...without('MIGRATE_URL', 'STRIPE_WEBHOOK_SECRET'), STRIPE_SECRET_KEY: `sk_live_${marker}`, DEMO_ACCESS_PASSWORD: marker });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('MIGRATE_URL: not set');
    expect(r.stderr).toContain('STRIPE_WEBHOOK_SECRET: not set');
    expect(r.stderr).toContain('STRIPE_SECRET_KEY: must start with sk_test_');
    expect(r.stdout + r.stderr).not.toContain(marker);
  }, 60_000);

  it('the script exits 0 on the complete set, and 1 with the core message when the core three are missing', () => {
    expect(script(good).status).toBe(0);
    const r = script(without('DATABASE_URL', 'AUTH_SECRET', 'APP_URL'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('core schema (src/core/env.ts): DATABASE_URL, AUTH_SECRET, APP_URL');
  }, 60_000);
});
