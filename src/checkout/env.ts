// Clone-owned Stripe env (D-26). The publishable key is public by design (Stripe Elements needs it in the browser);
// it is NEXT_PUBLIC_ so Next inlines it, and it lives here, not in src/core/env.ts, because INV-14 pins
// .env.example to the core schema and INV-20's secret-shape regex would refuse the word KEY. INV-20 was checked
// before adding it (2026-11-10): it inspects only envSchema, so this file is outside its scope; the name is
// Stripe's own and the value is not a secret. The secret key and the webhook secret stay in the core schema
// (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) and are read only by StripeLive and the webhook route.
export const stripePublishableKey = (): string | undefined => process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || undefined;
