// The production build's environment check (D-45). `scripts/vercel-build.mjs` runs it first on a Vercel Production
// build, so a missing or wrong variable fails the build with one list of names, instead of a 503, a 404 or a payment that
// never completes at request time. Names and reasons only: a value is never printed.
//
// Two layers: the core schema (`parseEnv` in src/core/env.ts, the same parse the app does at start-up), then what a
// deployed Turnstile demo needs beyond it. docs/DEPLOY.md lists every name with where its value comes from.
import { pathToFileURL } from 'node:url';

type Source = Record<string, string | undefined>;

/** The shortest shared demo password a Production build accepts. */
export const MIN_DEMO_PASSWORD = 16;

/** What a deployed Turnstile needs beyond the core schema. Each entry is `NAME: what is wrong`. */
export function turnstileProblems(source: Source): string[] {
  // As in the core parse: an empty `NAME=` is unset.
  const e = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')) as Source;
  const out: string[] = [];
  const need = (name: string, why: string) => {
    if (!e[name]) out.push(`${name}: not set (${why})`);
    return Boolean(e[name]);
  };

  need('MIGRATE_URL', "the database owner's direct, unpooled connection string; migrations run with it during this build");
  // PRD-2 item 8 (review SEC-4, D-66): the gate does one compare per request with no attempt limit, so the password's
  // length is what makes guessing hopeless. Characters, not bytes. The reason names the rule; never the value or its length.
  if (need('DEMO_ACCESS_PASSWORD', 'the shared demo password; without it every page of a Vercel deployment answers 503') && [...e.DEMO_ACCESS_PASSWORD!].length < MIN_DEMO_PASSWORD)
    out.push(`DEMO_ACCESS_PASSWORD: must be at least ${MIN_DEMO_PASSWORD} characters (it is the only barrier in front of the demo's owner accounts, and the gate has no attempt limit)`);
  need('CRON_SECRET', 'Vercel Cron sends it to /api/cron once a day; without it the daily sweep is refused');

  const emailOn = e.EMAIL_ENABLED !== '0' && e.RESEND_API_KEY && e.EMAIL_FROM;
  if (e.DEMO_MODE !== '1' && !emailOn) out.push('DEMO_MODE: must be 1 (with email off, /demo is the only way to sign in; without it /demo is a 404)');

  if (e.APP_URL && URL.canParse(e.APP_URL)) {
    const u = new URL(e.APP_URL);
    if (u.protocol !== 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') out.push('APP_URL: must be the https address of this deployment, not localhost (Stripe returns the buyer to it)');
    else if (u.pathname !== '/' || e.APP_URL.endsWith('/')) out.push('APP_URL: the origin only, no path and no trailing slash (links are built as APP_URL + path)');
  }

  // Stripe, test mode only (D-5). The three travel together: without any one of them a hold can be paid for and never ticketed.
  const stripe: [name: string, prefixes: string[], why: string][] = [
    ['STRIPE_SECRET_KEY', ['sk_test_', 'rk_test_'], 'creates the PaymentIntent and the refunds'],
    ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', ['pk_test_'], 'Stripe Elements in the browser; inlined at build time, so it must be here when the build runs'],
    ['STRIPE_WEBHOOK_SECRET', ['whsec_'], 'verifies the signed webhook at /api/checkout/webhook; tickets are issued only by it'],
  ];
  for (const [name, prefixes, why] of stripe) {
    if (!need(name, why)) continue;
    if (!prefixes.some((p) => e[name]!.startsWith(p))) out.push(`${name}: must start with ${prefixes.join(' or ')} (Stripe test mode only, D-5; a live key and the published fixture secret are both refused)`);
  }
  return out;
}

/** The core schema's verdict, as its own message (names only), or null when it parses. */
export async function coreProblem(source: Source): Promise<string | null> {
  try {
    // The module parses process.env when it loads, so on a broken environment the import itself throws the same message.
    const { parseEnv } = await import('@/core/env');
    parseEnv(source);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function deployProblems(source: Source): Promise<string[]> {
  const core = await coreProblem(source);
  return [...(core ? [core.replace(/^Invalid environment: /, 'core schema (src/core/env.ts): ')] : []), ...turnstileProblems(source)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = await deployProblems(process.env);
  if (problems.length) {
    console.error(`deploy-env: this Production build is refused. ${problems.length} problem(s) with the environment (names only; see docs/DEPLOY.md):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`deploy-env: OK (core schema parses; migration URL, demo gate (${MIN_DEMO_PASSWORD}+ characters), cron secret and the three Stripe test-mode values are present).`);
}
