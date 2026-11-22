# UX lens — Turnstile live release (main 9d8b434)

Brief: can a first-time visitor (a hiring manager with the password and the README link) finish README "Try the live demo" (README.md:7-60) without help?
Method: the README walk compared step by step with the production-build screenshots in `review/shots/` (1280 and 390) and the page code under `src/app/o/[org]/events/**`, `src/app/(public)/demo/page.tsx`, `src/app/o/[org]/page.tsx`, `src/components/{stripe-pay,countdown}.tsx`, `src/checkout/{format,words,stripe}.ts`. Read-only. The live site was not fetched. No real Stripe form was rendered (recorded double), so every claim about the live card step is Suspected.
Wording on the live product is Shane's: the fixes below are recommendations, not rewrites.

Short answer: **the visitor can finish the walk at 1280 only on a fresh org and only if someone gives them the URL outside the README.** Three things break it for the people it is written for. (1) The README on `main` still says the site does not exist and gives `<PRODUCTION_URL>`. (2) Every visitor acts as the same two shared customers, so from the second visitor on, the README's "you should see" lines are wrong. (3) The one-way clock step has no warning on screen, and a spent org gives no pointer to `globex`.

---

## Blocker

### UX-1 The README on main says the demo is not live and gives no address
- **Severity:** Blocker
- **Where:** README.md:9-13 and README.md:58-59 (at `9d8b434`, confirmed with `git show 9d8b434:README.md`)
- **Observed:** "**The site is not live yet.** There is no deployment: no Vercel project, no hosted database, no address… `<PRODUCTION_URL>` below is a placeholder". Then "Once it is live: open **`<PRODUCTION_URL>/demo`**". Line 59 says "Nothing here has been run against a live site, because there is none." The site has been live since 2026-11-21 (CONTEXT.md). DEPLOY.md step 9 (Replace `<PRODUCTION_URL>`… change the "not live yet" sentence) has not been done.
- **Why it matters:** this is the visitor's first screen. A hiring manager given the README link is told there is no site and no URL, so the walk can't start without asking Shane. If they do reach the site, the README contradicts what they see, and that undercuts the honesty the README is built around.
- **Recommended fix:** do DEPLOY.md step 9. Put the real address in the README and say plainly that it is live and behind a shared password. Reword line 59 to say what has and has not been run against the live site, including whether O-8 (the first real Stripe test payment) has been recorded.
- **Verified** (read directly)

## Major

### UX-2 Every visitor shares C-0001 and C-0002, so the walk's "you should see" lines are wrong from the second visitor on
- **Severity:** Major
- **Where:** README.md:26, 31-33, 37, 42; `buy/page.tsx:52-56` (holds, orders and late payments filtered by customer only); `box/page.tsx` order picker
- **Observed:** the README tells every visitor to act as `C-0001` (floor) and `C-0002` (balcony). The database is shared and never reset (README.md:52). The Buy screen shows *all* of that customer's holds and orders, whoever made them. So the second visitor finds the following:
  - "Your holds" may already hold an earlier visitor's live `HELD` hold, with its own **Pay** and **Release** buttons. A visitor can pay for or release someone else's hold.
  - "Your tickets" lists every earlier visitor's orders. README step 3 says "refresh until **Your tickets** shows one order with two ticket codes", but that order is never alone, and "Copy both codes" no longer says which two.
  - Box office step 5 says "the order of `C-0001`", but the picker has several C-0001 orders. The visitor may preview or refund another visitor's ticket. NEXT.md 2026-11-19 already flags this picker as 701 options long.
  - Step 4 ("tick two open seats with one open seat between them") still works. But C-0002's earlier balcony orders sit above it, and earlier visitors' sold seats are scattered through Section A.
- **Why it matters:** the walk's checks are what convince a reviewer. When the screen doesn't match the README, they will read it as a bug in the product.
- **Recommended fix (pick one):** (a) the README says "pick any customer from C-0100 to C-0700 that has no orders" and the steps say "your order" in place of "the order of C-0001". (b) The Acting-as picker marks customers who already have holds or orders, or offers "a fresh customer" by default. (c) "Your tickets" and the box-office picker sort newest first, and the README says to look at the newest. (a) is a README edit and changes no code.
- **Verified** (code read; multi-visitor state not rendered)

### UX-3 A spent org doesn't tell the visitor to switch to globex
- **Severity:** Major
- **Where:** `buy/page.tsx:131-135`; `src/checkout/format.ts:86-91` (`saleState`); `src/checkout/words.ts:16` (`SALES_CLOSED`); README.md:49-52
- **Observed:** after someone has done step 7 in `acme`, the next visitor's screens say only "Sales closed". The Buy screen shows "Sales run … to …. A hold or a waitlist join now is refused by the engine…", and only *after* a customer is chosen (`{me && …}`). Before that, the page says only "Pick a customer above to see what they can buy." A refused hold reads "Sales have closed." Nothing on any screen mentions `globex`, the demo, or the reset. The 11-globex-event-1280 shot shows the event page for an org past show night: every tier pill reads "Off sale since…", with no next step.
- **Why it matters:** D-49 makes this the *expected* state for most visitors after the first. The README covers it in a paragraph after step 7, which a visitor reads only after they have hit the wall at step 2.
- **Recommended fix:** when `saleState` is "Sales closed" and `DEMO_MODE` is on, show one line on the Events card and the Buy screen (above the customer picker). Something like: "This demo org has been used up (its clock is past show night). Sign in as owner@globex.demo.test from /demo, or ask the owner to reset." Also move the README's "Step 7 uses the demo up" paragraph above step 1. Decide alongside D-49.
- **Verified** (code read; the acme "Sales closed" Buy screen wasn't rendered)

### UX-4 "Set clock" spends the demo for every later visitor and the screen doesn't warn
- **Severity:** Major
- **Where:** `src/app/o/[org]/events/[event]/page.tsx:114-130`; 04-event-1280.png (Event clock panel)
- **Observed:** the panel says "Every command and screen reads this clock, which runs at wall-clock speed from where staff set it (D-35)… it can only move forward past the log." Then a datetime field and **Set clock**, with no confirmation. Nothing says that moving it to show night closes sales in this org for everyone, for good. Only the README (lines 45 and 49-52) says that.
- **Why it matters:** it is the one irreversible action in the walk and it affects other people. A curious visitor will try it early ("what if I jump to show night?") and spend `acme` before steps 2-6.
- **Recommended fix:** in demo mode, put a plain warning by the button, something like "One way: you can't move it back, and after 8:00 PM on show night nobody can buy in this org again", plus a confirm step when the target is past `sales_close_at`. Replace "(D-35)" and "past the log" with words: "it can't go back before the last thing that happened".
- **Verified** (read directly)

### UX-5 A member who presses Set clock gets a bare error page
- **Severity:** Major
- **Where:** 13-member-set-clock-1280.png / -390.png; `page.tsx:114-130` (form rendered for every role); `actions.ts:13` (`orgAction('org.update', …)` throws `AuthzError`); INDEX.md console log (HTTP 500, React error #441)
- **Observed:** `/demo` lists the two member accounts with one-click sign-in. A member sees the same Event clock panel and **Set clock** button as the owner, labelled only "Staff only". Pressing it replaces the whole app with "Something went wrong / Error id: 972102182 / Try again". There's no nav, no reason, and "Try again" repeats the same action. Already known (NEXT.md 2026-11-20); here is the UX side.
- **Why it matters:** a reviewer who picks a member account to see roles at work hits what looks like a crash, not a role refusal. That is the opposite of what the role split is meant to show.
- **Recommended fix:** for roles without `org.update`, render the panel read-only with a sentence such as "Only the org's owner or admin can move the event clock", or hide the form. Also have the action return `{ error }` instead of throwing, so `ActionForm` shows it inline.
- **Verified** (screenshot + code)

### UX-6 After paying with the live Stripe form, the card form probably comes back and nothing says "waiting for confirmation"
- **Severity:** Major
- **Where:** `src/checkout/stripe.ts:40-42` (`clientSecret` returns the secret whatever the PaymentIntent's status); `buy/page.tsx:66` and `:186-188`; `src/components/stripe-pay.tsx:16, 41-47`
- **Observed:**
  - **Card form returns.** Stripe redirects to `returnUrl` (`/buy?as=C-0001`, without `r`). Until the signed webhook lands, the hold is still `PAYING`, and with a publishable key set the page calls `clientSecret` and renders `<StripePay>` again. So the visitor who has just paid sees the card form and **Pay with Stripe (test mode)** again.
  - **No waiting message.** The "Refresh to see it land" hint appears only in the recorded-Stripe branch (`:188`). The live branch gives no sign that payment went through and tickets are pending.
  - **No success message.** Stripe's `redirect_status=succeeded` on the return URL isn't read.
  - **No loading text.** While Stripe.js loads, the button is disabled with no wording (`busy` starts `true`).
- **Why it matters:** README step 3 is the step nobody has run (O-8). "Refresh until Your tickets shows…" next to a fresh card form invites a second payment attempt, or a belief that the first one failed.
- **Recommended fix:** for a `PAYING` hold, skip the form when the PaymentIntent is `processing`/`succeeded` (or when `redirect_status=succeeded`). Show "Payment received by Stripe; your tickets appear when Stripe confirms it, usually within seconds. Refresh this page." Give the button a "Loading the card form…" state. Watch this during the O-8 smoke check.
- **Suspected** (the live form was never rendered; inferred from code)

## Minor

### UX-7 The org home is a template empty state: "Nothing here yet. Invite your team"
- **Severity:** Minor
- **Where:** `src/app/o/[org]/page.tsx:9-10` (comment: "The clone replaces this page with its own home"); 02-org-home-1280.png, 02-org-home-390.png
- **Observed:**
  - **Wrong advice.** After `/demo` → `/onboarding` ("Your orgs") → **Acme Studio**, the visitor lands on "Nothing here yet. This org is ready. Invite your team to get started." In a seeded ticketing demo that is untrue, and it points away from the walk.
  - **Events is hidden among template links.** The nav has nine links, most of them template settings (Projects, Members, Audit log, Security, SSO, API keys, Export or delete).
  - **Phone.** At 390 the nav is cut off after "Events" (02-org-home-390.png).
- **Why it matters:** the first page after sign-in suggests the product is empty. README step 1 ("→ **Events**") only works if the visitor trusts the README over the screen.
- **Recommended fix:** make the clone's org home redirect to, or render, the Events list. Failing that, have the empty state link "See the event" first.
- **Verified**

### UX-8 /demo gives no hint which account to pick
- **Severity:** Minor
- **Where:** `src/app/(public)/demo/page.tsx:16-27`; 01-demo-1280.png
- **Observed:** six buttons in alphabetical order (admin, member, owner). The account the README uses for every step, `owner@acme.demo.test`, is fifth. The only words on the page are "Seeded demo accounts. Pick one to sign in, no email needed."
- **Why it matters:** a visitor arriving from a link (not the README) picks the first button, which is admin. Picking a member account leads to UX-5.
- **Recommended fix:** one line naming the starting account, or list `owner@acme` first. If the page is template-owned, do it through a clone hook or a README change, not an edit to template code.
- **Verified**

### UX-9 After choosing a customer, "Acting as" moves to the bottom of a very long page
- **Severity:** Minor
- **Where:** `buy/page.tsx:120` vs `:341` (`{!me && picker}` at top, `{me && picker}` at bottom); 06-buy-hold-c0001-1280.png, 06-buy-hold-c0001-390.png
- **Observed:** README step 4 starts "Change *Acting as* to `C-0002`". Once a customer is chosen, the picker is below the floor table, the 6×12 seat grid and the waitlist: about 2,400 px down at 1280 and about 4,300 px down at 390 (the bottom of 06-buy-hold-c0001-390.png). The title "Buy tickets · acting as C-0001" has no "change" link.
- **Why it matters:** this is the one switch the walk asks for mid-flow, and it is placed where the visitor is least likely to find it, especially on a phone.
- **Recommended fix:** add a "change customer" link next to the title (jumping to `#as`), or keep a compact picker at the top.
- **Verified**

### UX-10 The Buy form defaults to EARLY × 1; the walk asks for ADV × 2
- **Severity:** Minor
- **Where:** `buy/page.tsx:243-247`; 06-buy-hold-c0001-1280.png
- **Observed:** the tier select starts on "EARLY · $25.00", and Quantity starts at 1 (the Box office form starts at 2). README step 2 asks for ADV and 2, and step 3 quotes $76.98. A visitor who presses **Hold tickets** without changing both gets a different hold, a different Pay amount, and later a different refund and ledger figure. Recovery exists (**Release**), but nothing points to it.
- **Recommended fix:** say "change Tier to ADV and Quantity to 2" in the README more prominently, or default to the first tier's quantity of 2 to match Box office. Small either way.
- **Verified**

### UX-11 The "Payment started" banner stays after the tickets are issued
- **Severity:** Minor
- **Where:** 06b-buy-paid-c0001-1280.png; `buy/page.tsx:110-117`, `:188`
- **Observed:** after the webhook lands, the top banner still reads "Payment started. The tickets are issued when the payment is confirmed. OK PAYING · pi_rec_…". Directly below, **Your tickets** shows "Paid", T-00001 and T-00002 ISSUED. The `?r=` result follows the URL, so the "Refresh to see it land" advice brings the stale banner back on every refresh. In live mode Stripe's return URL drops `r`, so this hits mainly the recorded path, plus any visitor who refreshes before reaching the card form.
- **Recommended fix:** when the result's hold has moved on (CONFIRMED), show the newer state or hide the old banner.
- **Verified** (screenshot)

### UX-12 Decision numbers and internal terms in visitor-facing copy
- **Severity:** Minor
- **Where:**
  - Buy: "Staff only (D-32)" (`buy/page.tsx:86`)
  - Event clock: "(D-35)", "move forward past the log" (`page.tsx:116-117`)
  - Rules: "dropped (DROP)", "Read-only · set in event.json"
  - Events list: "PRD non-goal: multi-event scheduling" (03-events)
  - Banner: "OK PAYING · pi_rec_H-2AF305D1 7698" (06b)
- **Observed:** the engine codes beside sentences (OK HELD, REJECT ORPHAN_SEAT, DOORS_NOT_OPEN) are promised by the README and work: sentence first, code second. Decision numbers, "the log", "event.json", "PRD" and raw PaymentIntent ids mean nothing to the visitor.
- **Recommended fix:** keep the engine codes. Drop the D-numbers, or turn them into a link to `docs/decisions.md`. Swap "the log" for "the last thing that happened".
- **Verified**

### UX-13 Times without dates read as "today"
- **Severity:** Minor
- **Where:** 08a-box-office-1280.png (ON SALE NOW: "EARLY until 12:00 AM · ADV until 5:00 PM · BALC until 8:00 PM"); 10b-door-not-open-1280.png (pill "Doors open 7:00 PM" next to "Event clock 2026-12-01…")
- **Observed:** EARLY actually ends 2027-01-16 00:00 and the others on 2027-03-20. The Door pill looks like a status ("doors are open") when it means a time on another day.
- **Recommended fix:** add the date when it isn't the event clock's day ("until Jan 16, 12:00 AM"). Word the pill as "Doors open Mar 20, 7:00 PM".
- **Verified**

### UX-14 An orphan refusal clears the pick and names no seat
- **Severity:** Minor
- **Where:** 07-buy-orphan-refusal-1280.png; `buy/actions.ts:30` (redirect drops the picked seats)
- **Observed:** "That pick would leave a single open seat stranded… Shift the pick by one seat or take the single too." All 72 seats then show open again with nothing ticked, so the visitor can't see which seats they picked or which one would be stranded. NEXT.md 2026-11-19 already lists "orphan refusal names no seat".
- **Recommended fix:** carry the picked seats back as ticks, and name the stranded seat (e.g. "A-A-02 would be left alone").
- **Verified**

### UX-15 "Back to the wall clock" either fails or breaks the walk on the demo
- **Severity:** Minor
- **Where:** `actions.ts:27-30`; 04-event-1280.png (Wall clock 2026-11-21 19:08:11 vs event clock 2026-12-01 10:03:08)
- **Observed:** the seed starts each event clock at sales open, ahead of the wall clock (D-47). Once any command exists, "Back to the wall clock" is refused ("The log's last command is at … cannot go before it"). On a fresh org it succeeds, but it moves the clock *before* sales open, so the next Buy attempt is refused (SALES_NOT_OPEN) until someone sets the clock forward again.
- **Recommended fix:** hide or disable it in demo mode when the wall clock is before sales open or before the log, with a sentence saying why.
- **Verified** (code read; not pressed)

### UX-16 The clock field shows the browser's 12-hour format; the README gives 24-hour
- **Severity:** Minor
- **Where:** 04-event-1280.png ("12/01/2026, 10:03:08 AM"); README.md:46 ("`2027-03-20 19:00:05`")
- **Observed:** a US-locale visitor has to translate to "03/20/2027 07:00:05 PM" in a segmented control. Phone pickers often show no seconds field.
- **Recommended fix:** README: "set it to 20 March 2027, 7:00:05 PM (or any time after 7 PM and before 8 PM)".
- **Verified**

### UX-17 Plurals: "1 orders", "1 lines"
- **Severity:** Minor
- **Where:** 09-ledger-1280.png; `ledger/page.tsx:73`, `:84`
- **Observed:** "7,698¢ · 1 orders and 0 late payments"; "1 lines". `late payment${…}` already handles the plural; the other two don't.
- **Verified**

### UX-18 The walk's figures expire as the event clock ticks
- **Severity:** Minor
- **Where:** README.md:39-42; D-47 (clock set to sales open on first load, then runs at wall speed); 04-event-1280.png
- **Observed:** the shot shows the event clock about 9.6 days ahead of the wall clock. Production's offset depends on deploy time; the following assumes it is similar. The figures then expire as follows, even if nobody does step 7:
  - **Around wall 2027-01-07:** the event clock passes EARLY's off-sale (2027-01-16).
  - **Around wall 2027-02-09:** it passes 30 days before the show (2027-02-18 20:00 event time). After that, step 5's "full $38.49" and step 6's "$38.49 / $165.49" no longer match.
  - **Around wall 2027-03-11:** sales close by themselves in both orgs.
- **Recommended fix:** add one README line saying the figures assume the event clock is more than 30 days before the show. If the demo is to run past February, schedule a reset (part of D-49).
- **Suspected** (offset taken from the local render, not production)

---

## Checked and clean
- **Step 1:** two pools (800 floor, 216 balcony), four tiers each with remaining and available, the "How 'available' is worked out" box, and the pool note "allotments add up to more than it holds" (04-event-1280).
- **Step 2:**
  - "Held for you" banner with `OK HELD · H-…`, a "09:59 left to pay · until …" countdown, and "Pay $76.98" (06-buy-hold-c0001-1280). The figures match the README.
  - "Where you are" steps highlight the current step.
- **Expired hold:** the countdown shows "Time is up. Checking with the server…" and refreshes (`countdown.tsx:28`). Ended holds show a word pill plus the code (`buy/page.tsx:194-201`).
- **Late payment:** shown as a full-refund receipt in words (`buy/page.tsx:136-158`).
- **Pending state:** every engine action goes through `ActionForm`, which disables the whole fieldset while pending, so there are no double submits. (There is no "working…" text; that is cosmetic.)
- **Step 4 refusal:** a sentence first, then `REJECT ORPHAN_SEAT`, matching the README (07). The seat legend is explained in words.
- **Step 5:**
  - The refund preview shows order, paid, days before the show (109), the window in words, the "Customer gets back $38.49" box with the rounding rule, and a **Refund $38.49** button (08b-box-refund-preview-1280).
  - The refund flow fits at 390 with no horizontal scroll (08b-…-390).
- **Step 6:**
  - The ledger shows captured, refunded and net, with the cents equation and Download CSV (09-ledger-1280).
  - The globex ledger paginates (452 lines, 50 per page) and explains late money (12-globex-ledger).
- **Step 7 (refusal half):** "DO NOT ADMIT — Doors are not open yet; they open at 2027-03-20 19:00:00." matches the README. The Door hint explains both accepted code forms and the refusal order (10b).
- **Wrong customer:** the engine has words for HOLD/WAITLIST/ORDER_NOT_YOURS (`words.ts:29,34,42`).
- **Declined card:** Stripe's `confirmPayment` error is shown inline with role=alert (`stripe-pay.tsx:34,45`). Live decline path not run.

## Not reviewed / could not check
- The live site (not reachable from the sandbox) and the live Stripe Elements form: never rendered by anyone (O-8).
- The `/onboarding` "Your orgs" screen between `/demo` and the org (not in the shot set; read in code only).
- **Door step, rest of the walk:** ADMIT, the second-scan refusal with the first scan's time, and refund-at-door refusal (no shot; INDEX caveat).
- **Box office step, after the refund:** executing the refund and the post-refund screen (previewed only).
- The acme Buy screen in the "Sales closed" state, and a fresh `globex` walk. The globex shots are post-cast, and production's globex is not cast (D-47).
- Dark mode beyond the event page; keyboard-only completion of the walk (accessibility lens).
- Declined card, the `payment_intent.payment_failed` path, and PAID_AFTER_TIMEOUT on the live screen.
