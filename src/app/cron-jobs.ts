import { drainOutbox, sweepOutbox } from '@/modules/notifications/outbox'; // notifications
import { recheckSsoDomains, sweepSsoStates } from '@/modules/sso/hooks'; // sso
import { cronWebhooks } from '@/modules/apikeys/webhooks'; // apikeys
import { resetDemo } from '@/checkout/demo-reset';
import { retryPendingRefunds } from '@/checkout/refund-retry';
import { stripeGateway } from '@/checkout/stripe';
import { demoEnabled } from '@/core/auth/demo';

// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
export async function cronJobs(): Promise<Record<string, unknown>> {
  const jobs: Record<string, unknown> = {};
  jobs.outbox = { ...(await drainOutbox()), swept: await sweepOutbox() }; // notifications
  jobs.ssoStates = await sweepSsoStates(); // sso
  jobs.ssoDomains = await recheckSsoDomains(); // sso
  jobs.webhooks = await cronWebhooks(); // apikeys
  // Turnstile's own jobs. Each is fenced: a fault here is one line in the answer, and the template's sweeps above have already run.
  // PRD-3 item 12: refunds Stripe has not confirmed are retried only while a retry can be shown to reuse the same
  // idempotency key inside Stripe's window; the rest are counted as needing the owner (refund-retry.ts, D-70).
  jobs.refunds = await fenced('refund retry', () => retryPendingRefunds(stripeGateway));
  // D-60: only when DEMO_MODE=1, wipe the Turnstile tables and re-seed both demo orgs, after the refund retry above so
  // that a refund Stripe has now confirmed does not hold the reset back. It refuses, and says why, while a refund is
  // unconfirmed or an open PaymentIntent could not be cancelled (demo-reset.ts).
  jobs.demoReset = await fenced('demo reset', () => resetDemo({ demoMode: demoEnabled(), gateway: stripeGateway }));
  return jobs;
}

/** A Turnstile job must not take the whole cron answer down with it. The error's class is logged, never its text. */
async function fenced<T>(name: string, job: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await job();
  } catch (e) {
    console.error(`[turnstile] cron job "${name}" failed: ${e instanceof Error ? e.constructor.name : 'error'}`);
    return { error: 'failed; see the log' };
  }
}
