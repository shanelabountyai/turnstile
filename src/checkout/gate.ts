// The deployed demo's password gate, Turnstile's half (D-46). The check itself is core's (`@/core/demo-gate`, v1.6.5:
// HTTP Basic, any username, fails closed on Vercel without a password, open off Vercel). This file holds only the
// clone's own exempt paths and the one decision `src/proxy.ts` makes, so both can be tested without a server.
import { CORE_OWN_CREDENTIAL, gate, gateResponse } from '@/core/demo-gate';

/**
 * Paths that carry a credential of their own, so the password never stands between a caller and the route:
 * `/api/cron` (CRON_SECRET, core's list), `/api/checkout/webhook` (Stripe's signature: Stripe cannot answer a Basic
 * challenge), and `/api/v1/**` (bearer API keys, which use the same Authorization header).
 */
export const ownCredential = (path: string): boolean =>
  (CORE_OWN_CREDENTIAL as readonly string[]).includes(path) || path === '/api/checkout/webhook' || path.startsWith('/api/v1/');

/** null = let the request through; otherwise the response to send instead (401 challenge, or 503 with no password on Vercel). */
export function admit(path: string, authorization: string | null, e?: Parameters<typeof gate>[1]): Response | null {
  if (ownCredential(path)) return null;
  const g = gate(authorization, e);
  return g === 'open' || g === 'allowed' ? null : gateResponse(g);
}
