# Security lens — Turnstile live release (main 9d8b434)

Read-only. Repo at 9d8b434 (`git log -1`). No secret value is printed below. "Exploitable by (a)" = someone without the demo password; "(b)" = someone with it (who can become owner of `acme` and `globex` from `/demo`, by design, D-46).

Counts: Blocker 0, Major 1, Minor 7.

---

> **Correction 2026-11-22 (D-55): SEC-1 and SEC-2 are refuted.** The template already refuses a demo session for every action named below: `assertNotDemo` (`src/core/auth/session.ts:109`) is called by `assertFresh` (so `deleteOrg` and export), by `withMembers` (`src/core/tenancy/orgs.ts:58`), by invites (`src/core/tenancy/invites.ts:22`), by SSO settings (`src/modules/sso/settings.ts:26`), by API key minting (`src/modules/apikeys/keys.ts:23`) and by webhook endpoints (`src/modules/apikeys/webhooks.ts:77`). `e2e/security-pages.spec.ts:28,33` asserts the refusal text on the live demo owners. This lens missed those calls. Found when a proxy lockdown built for SEC-1 broke that spec; the lockdown was not kept.

## SEC-1 — The shared password hands every visitor the owner's destructive controls, so one visitor can break the demo for everyone
- **Severity:** Major
- **Where:** `src/core/authz/permissions.ts:7` (owner holds `org.delete`, `members.manage`, `apikeys.manage`); `src/app/o/[org]/settings/danger/actions.ts:11` (`destroyOrg`); `src/app/o/[org]/settings/{members,sso,apikeys}/actions.ts`; `src/app/(public)/demo/signin/route.ts` (signs in any `isDemo` user, owner included, MFA marked passed, `src/core/auth/demo.ts`); `scripts/seed-hosted.ts` (re-seeds only on a Production build).
- **Observed:** Behind the one password, `/demo` signs anyone in as the owner of `acme` or `globex`. The owner can delete the org, remove or demote the other demo accounts, switch on "Require SSO" (which `requireOrg` then enforces, sending every demo session to an SSO sign-in that does not exist), or mint API keys (SEC-2). Nothing in clone code limits demo accounts to the walk. The re-seed runs only on a Production build, and `vercel.json`'s `ignoreCommand` skips builds that change nothing outside docs, so the damage stays until Shane redeploys a code change or runs the D-49 reset by hand.
- **Why it matters:** D-46 rightly says the gate is not access control, and D-49 records the slow, accidental wear-out (the one-way clock). This is the fast, deliberate version: one curious reviewer who has the password can take both orgs offline in under a minute (delete `acme`, delete `globex`) while Shane is mid-demo. The live logs show scanners already hitting the domain, so anyone the password reaches is a real risk. Exploitable by (b) only. (a) cannot do it.
- **Recommended fix (not applied):** In clone-owned `src/proxy.ts`/`gate.ts`, when `DEMO_MODE=1`, refuse (403) POSTs to `/o/*/settings/{danger,members,sso,apikeys}`, or offer only admin/member demo accounts for the walk. Combine with D-49 option (c), a nightly reset, so anything that gets past this still heals. Record the choice next to D-46.
- **Verified** by reading (permissions table, actions, demo sign-in, seed path). Not exercised against the live site.

## SEC-2 — API keys minted behind the password keep working without it (`/api/v1/**` is exempt from the gate)
- **Severity:** Minor
- **Where:** `src/checkout/gate.ts` (`ownCredential`: `path.startsWith('/api/v1/')`); `src/app/o/[org]/settings/apikeys/actions.ts:17` (`createApiKey`, `createWebhookEndpoint`); `src/app/api/v1/{events,projects,projects/[id]}/route.ts`; decisions D-6 (CLAUDE.md says API keys "unwired"; the as-built row, `docs/decisions.md:138`, says apikeys was left in place).
- **Observed:** A demo owner or admin can create an API key and a webhook endpoint from Settings. `/api/v1/**` skips the Basic gate (correctly, because bearer keys use the same header), so the key keeps working after `DEMO_ACCESS_PASSWORD` is changed. The daily cron (D-48) delivers queued events to whatever URL was registered. The URL check is the template's SSRF filter (A-01, fixed in v1.6.4/v1.7.0).
- **Why it matters:** Rotating the shared password does not fully revoke a past holder's access. What that access reaches is small: template `Project` rows (read/write) and `project.created` events (`src/app/event-types.ts`). No Turnstile data (events, orders, customers, payments) is behind `/api/v1`. The bigger risk is that it contradicts the "unwired" line in CLAUDE.md/D-6, so a later reader may believe this surface does not exist. Exploitable by (b), and that access then outlives the password.
- **Recommended fix:** Either actually unwire it (remove the apikeys module with the manifest, or stop exempting `/api/v1/` and refuse the settings actions in demo mode as in SEC-1), or record in D-46/D-6 that keys outlive a password rotation and that rotating the password means revoking keys too.
- **Verified** by reading.

## SEC-3 — The Stripe webhook reads the database before it checks the signature
- **Severity:** Minor
- **Where:** `src/app/api/checkout/webhook/route.ts:13-22` (JSON parse, `event.findUnique` by `metadata.event_id`, 404 `unknown event`), then signature check in `applyWebhook` (`src/checkout/checkout.ts:36`).
- **Observed:** An unsigned POST (the path is exempt from the gate) is parsed, and an `event_id` from the body is looked up with `asSystem`. The caller gets 404 `unknown event` for a missing id and 400 `bad_signature` for an existing one, so the route tells an unauthenticated caller whether an event UUID exists. A non-UUID `event_id` is passed to a `@db.Uuid` column (`prisma/schema/turnstile.prisma:66`), which in Prisma raises an error rather than returning null, so that request most likely gets a 500 and a stack line in the Vercel logs (Suspected, not run). An unsigned request **cannot** create a sale, refund or any CommandLog row: the HMAC check (timing-safe, 300 s tolerance, raw body) runs before any cast.
- **Why it matters:** The impact is low (event ids are random UUIDv4s), but every anonymous request costs a database wake, and the order differs from the stated design ("the signature is the guard"). Exploitable by (a).
- **Recommended fix:** `STRIPE_WEBHOOK_SECRET` is global, not per event, so call `verifyStripeSignature` in the route before the lookup and return the same 400 for every unverified request. Validate `event_id` as a UUID before querying.
- **Verified** (order and status codes, by reading). The 500 on a non-UUID id is **Suspected**.

## SEC-4 — No attempt limit on the password gate, and no strength check on the password
- **Severity:** Minor
- **Where:** `src/core/demo-gate.ts` (`gate`: one compare per request, no counter); `scripts/deploy-env.ts:22` (`need('DEMO_ACCESS_PASSWORD', …)` checks presence only).
- **Observed:** Each request gets one timing-safe compare (SHA-256 digests, `timingSafeEqual`) with no lockout or rate limit. The build accepts any non-empty password.
- **Why it matters:** The password is the only barrier between the internet and owner access (SEC-1), and unauthenticated traffic is already arriving (the 2026-11-21 scanner probes). A strong password makes online guessing hopeless. A short one does not. I could not see the value or the Vercel firewall settings. Exploitable by (a), but only if the password is weak.
- **Recommended fix:** Add a minimum length (for example ≥ 16) in `turnstileProblems`, and/or add a Vercel Firewall rate-limit rule on 401 responses for the domain. Core's gate is template-owned, so don't change it here.
- **Suspected** (the impact depends on a password value I could not see). The missing limit is verified.

## SEC-5 — Any member, the lowest role, can refund, check in and sell; only the clock needs a permission
- **Severity:** Minor
- **Where:** `src/app/o/[org]/events/[event]/box/actions.ts:18` (`confirmRefund`, `orgAction(null, …)`); `door/actions.ts:14` (`scanTicket`, null); `buy/actions.ts:37-48` (all null); `actions.ts:12` (`setEventClock`, `org.update`).
- **Observed:** The money-moving action (`requestRefund` calls Stripe `refunds.create`) needs only membership. D-32 calls the Buy screen "staff-only", and the decisions log has no permission model for staff below admin.
- **Why it matters:** In the demo every role is one click away, so nothing changes there. But the role split is presented as real (owner/admin/member accounts on `/demo`), and a reviewer who reads the code will notice that a member can issue refunds. Exploitable by (b), which could already do it as owner.
- **Recommended fix:** Decide and record it: either "every member is box-office staff" (a decisions row), or gate `confirmRefund` behind a permission and return a refusal instead of throwing (see the known `AuthzError` error-page item).
- **Verified** by reading.

## SEC-6 — The CSP is `frame-ancestors 'none'` only: no script, connect or frame allowlist
- **Severity:** Minor
- **Where:** `next.config.ts:7`; `src/components/stripe-pay.tsx:38` (loads `https://js.stripe.com/v3`); `e2e/headers.spec.ts` checks only `frame-ancestors`.
- **Observed:** The only CSP directive is `frame-ancestors`. Nothing restricts `script-src`, `connect-src` or `frame-src`, so there is no CSP that "allows js.stripe.com", because nothing is blocked. I found no XSS sink in clone code (no `dangerouslySetInnerHTML` under `src/app/o`, `src/checkout`, `src/components`; React escapes free text such as the door code).
- **Why it matters:** This is hardening, not an open hole. A future injection bug would have no second line of defence.
- **Recommended fix:** Add `script-src 'self' https://js.stripe.com` (plus whatever nonce or hash Next needs), `frame-src https://js.stripe.com https://hooks.stripe.com`, and `connect-src 'self' https://api.stripe.com`. Extend `headers.spec.ts` to cover them. Try report-only first.
- **Verified** by reading.

## SEC-7 — `npm audit --omit=dev`: 3 high, all in the Prisma CLI chain
- **Severity:** Minor
- **Where:** `package.json:66` (`prisma ^7.10.1`, installed 7.10.1).
- **Observed:** Run on 2026-11-22, the totals were 0 critical, 3 high, 0 moderate, 0 low. The three are `prisma`, `@prisma/config` and `effect`, all one advisory: "Effect: ReDoS in Schema.TemplateLiteral compiled regex". npm's suggested fix is `prisma@6.12.0`, a major downgrade. `next` 16.4.5, `stripe` 23.1.0 and `@prisma/client` 7.10.1 have no advisories.
- **Why it matters:** The CLI runs at build time (migrations), and request data never reaches that regex, so I see no runtime path. It will keep showing up in every audit.
- **Recommended fix:** Don't take the downgrade. Watch for a Prisma 7.x release that bumps `effect`, or move `prisma` to devDependencies if the Vercel build allows it. Record the call.
- **Verified** (ran `npm audit --omit=dev --json`).

## SEC-8 — Nothing limits how many commands a signed-in session can write to the append-only log
- **Severity:** Minor
- **Where:** `src/app/o/[org]/events/[event]/{door,buy,box}/actions.ts` (no rate limit; core's rate-limit table is not used by clone code); `door/actions.ts:21` (free text up to 64 chars cast as `ref`).
- **Observed:** Each form post writes one CommandLog row, and the log is append-only by trigger (D-21). A script holding the password and a session cookie can post door scans without limit.
- **Why it matters:** Unbounded database growth on the hosted Postgres, and a CommandLog full of junk that the reset in D-49 has to clear. Exploitable by (b).
- **Recommended fix:** A per-session or per-org rate limit on the cast actions in demo mode (core's Postgres rate limiter), or accept it and say so in D-46.
- **Suspected** (impact not measured).

---

## Checked and clean
- **Secrets in git history:** `git log --all -p` has 0 matches for `sk_live_`/`sk_test_`/`rk_*_` with a key body. The `pk_*_` matches are only in prose. The `whsec_` matches are 3 distinct strings, 13–17 characters long, each containing a placeholder word (`test`, `fixture` or `example`), in docs and template tests. The only env file ever added is `.env.example`, with every value empty. `.gitignore` covers `.env` and `.env.*`.
- **Fixture signing secret:** `fixtures/stripe/webhook.json`'s secret is 64 characters and does **not** start with `whsec_`, so `deploy-env.ts` refuses it at build. The check also refuses live keys (`sk_test_`/`rk_test_`, `pk_test_` and `whsec_` prefixes are required). Values are never printed. `tests/checkout/deploy-env.test.ts` exists.
- **Cross-org by URL:** every events page, action and the CSV route starts with `requireOrg(slug)` (membership is read from the database, and a non-member gets notFound). `eventByKey(ctx.orgId, key)` is keyed on `(orgId, eventKey)`. Customer, order, ticket and CommandLog lookups are then scoped to that event or org. Org A's session gets 404 on org B's event URL.
- **Webhook after verification:** HMAC-SHA256 over `${t}.${rawBody}` on the raw text body, `timingSafeEqual` with a length check, 300 s tolerance, dedupe on `event.id` through the CommandLog (`PAYMENT_DUPLICATE`), unknown event types get 200 and are ignored, and the Stripe client is built only when a refund has to move. The error bodies are short reason codes. The response's `Result` is returned only to verified calls.
- **Gate:** the compare is timing-safe (core). The matcher excludes only `_next/static`, `_next/image` and `favicon.ico`. The exempt list is exact (`/api/cron`, `/api/checkout/webhook`) plus the `/api/v1/` prefix. It fails closed (503) on Vercel when the password is unset. `/api/health` and `/robots.txt` stay behind it. Unit-tested in `tests/checkout/gate.test.ts`.
- **Open redirects:** every `redirect()` in clone code builds an internal path from `ctx.slug` (verified membership), `ev.eventKey` (from the database), a regex-checked customer id, a DB-checked order id and a server-minted `cmd_id`. `/demo/signin` redirects to the fixed `/onboarding` and is same-origin checked.
- **`?as=` / `?r=` / `?order=` / `?t=`:** `as` is matched against the org's own customer list, `r` is looked up in this event's CommandLog, and `t` is filtered to the selected order's tickets. None of them is interpolated into HTML or SQL (Prisma parameterises every query).
- **CSV export:** core's `toCsv` defuses leading `= + - @ \t \r` and quotes per RFC 4180. Every ledger column is a server-made id or an integer. (Correctness note for the other lens: a negative cents value would come out as `'-123`.)
- **Stripe client secret:** fetched only for the acted-as customer's PAYING holds and rendered only to signed-in members. That is the intended use.
- **Personal data in logs:** clone code (`src/checkout`, the events routes, the webhook route, `src/proxy.ts`) makes no `console.*` or `log()` calls. The data is synthetic.

## Not reviewed
- The live site's actual responses and headers (it can't be fetched from this sandbox). I also didn't check whether `next.config.ts` headers are added to the proxy's own 401/503 responses.
- Vercel project settings: environment values, Firewall/WAF rules, Deployment Protection. These were not inspected. SEC-4's real exposure depends on them.
- The Stripe Dashboard webhook endpoint configuration (which events, which secret) and whether other projects share the test account.
- Template-owned modules (`src/core/**`, `src/modules/**`) beyond how the clone uses them. Their audit is `docs/audits/AUDIT-2026-11-17.md`.
- No test suite or e2e was run by this lens. The Prisma non-UUID behaviour in SEC-3 was not reproduced.
