// Clone-owned, like cron-jobs.ts and org-hooks.ts: modules this clone's own code depends on
// outside the marked lines (an import `foundation:check-modules` wouldn't otherwise see coming).
// foundation:check-modules leaves these in place and still removes the rest.
// notifications: src/checkout/notices.ts queues order and offer notices into the outbox (D-33).
export const REQUIRED_MODULES: string[] = ['notifications'];
