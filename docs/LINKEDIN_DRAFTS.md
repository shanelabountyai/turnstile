# LinkedIn drafts — Turnstile goes live (2026-11-21)

**Status: two drafts, unposted.** Shane picks, edits and posts; nothing here has been published or added to the Ledger.
Both are about a **sample build on synthetic data**, never a client. Every figure carries its source in this repository.
Not duplicated: Ledger #170 (late money refunded) and #171 (waitlist head never skipped), listed in `docs/RELEASE_NOTES.md`.
Avoided on purpose: the "tests were green but it was still broken" theme (already in several queued posts, NEXT.md 2026-11-13),
and any detail of an open weakness on the live site (the review's open findings stay out until they are fixed).

---

## Draft 1 — "Live" is not the same as "proven" (pillar: Scale / AI Integration)

**Post only after** the first real Stripe test payment is recorded (EVAL O-8) — or keep the third paragraph as written,
which says it has not happened.

> My ticketing demo went live on Saturday. The most important sentence in its README is the one that says what it hasn't done yet.
>
> I've run launches where "live" meant the build was green and everyone went home. Then the first real transaction found the gap.
>
> So this sample build (an invented 1,016-seat hall, synthetic data, Stripe in test mode) has a rule written into it: until I've pushed a real test card through it and recorded the ids, the only claim allowed is "tested against recorded payloads." Not "works with Stripe."
>
> The engine agrees with a separate reference model on 2,662 commands, including 152 the rules should refuse and 79 deliberate traps. That sounds strong. It's also written by the same author as the test data, so it's an upper bound on correctness, not a measurement of it. The repo says that too.
>
> AI wrote most of the code. What AI didn't decide is what we're allowed to claim. That part is still the operator's job, and it's the part I'd want a team to copy.
>
> What's the one claim your team makes at launch that nobody has actually checked?
>
> #marketingoperations #ai #launch #claudecode

**Sources:** "went live on Saturday" = Vercel deployment `dpl_8aMfYPVd5DxeyZ5bjHxXps2aYmub` READY 2026-11-21 (`docs/DEPLOY.md`);
1,016 seats = `CLAUDE.md`, `prd-turnstile.md`; 2,662 / 152 / 79 = `docs/EVAL.md` and `CLAUDE.md` non-negotiable 12, re-run this session
(`npm run inventory:eval`: "7 expected files and expected_summary.json match (2662 commands)"); the claim rule = `docs/DEPLOY.md` step 8.5 and D-24.
**Guardrail check:** sample build named as such; no client; no career number used (add one only from the resume master, e.g. the
72-person website rebuild delivered on schedule, if Shane wants an anchor in paragraph 2).

---

## Draft 2 — Five reviewers who never talked to each other (pillar: AI Integration, riding on Scale)

> Before I handed out the password to my live demo, I had it reviewed five times. By five reviewers who never saw each other's notes.
>
> One for the user's path. One for visual design. One for accessibility. One for security. One for the code itself. Then a sixth whose only job was to rank what came back, not to review anything.
>
> They came back with 57 findings. The ranking turned them into 30 pieces of work, and put two money-handling fixes ahead of everything else, including the security finding. Its reasoning: nobody can exploit the security issue until I share the password, but the money issues would show up the first time I tested a real payment.
>
> That's the call I used to make in a program office at 1,000+ projects a year: not "what's worst," but "what bites first."
>
> All six reviewers were AI agents. The work they did was the easy part. The hard part was the brief: one lens each, no peeking, findings marked verified or suspected, and a suspected finding can't be a blocker.
>
> It's a sample build on synthetic data, and nothing got fixed in that pass. That was the point: decide first, then build.
>
> How do you keep reviewers from agreeing with each other too early?
>
> #marketingoperations #ai #qualityassurance #claudecode #pmo

**Sources:** 57 findings, 30 work items, the ranking and its reasoning = `docs/audits/FIVE-LENS-2026-11-21.md` (sections 1 and 2,
"Where this order differs from lens severity"); "a suspected finding cannot be a Blocker" = the review's finding format in the same
report; "1,000+ projects a year" = Shane's verified record (Lumen). **Guardrail check:** describes no specific weakness on the live
site; sample build named; no client; PMI not mentioned.

---

Want either warmer, shorter, or with a different hook? Read it out loud first: if it sounds like Shane, it's ready.
