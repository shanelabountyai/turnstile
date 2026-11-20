# Foundation patches

Template-owned files this clone has changed, each excused by its diff hash (`foundation:drift` prints it). Each moves
upstream at the next template release and its line is then deleted.

- `src/proxy.ts` `e26793f5eb02` — Turnstile D-46 (deploy prep, 2026-11-20): an added file, no template line changed. The path is on drift's owned list, but the template ships no `proxy.ts`; v1.6.5's changelog says the gate is "checked by the clone's `proxy.ts`" and that a clone's own exempt paths stay there. It calls core's `gate` through `admit` in clone-owned `src/checkout/gate.ts` (exempt: `/api/cron`, `/api/checkout/webhook`, `/api/v1/**`). Propose upstream: ship a template `proxy.ts` that reads the clone's exempt paths from a clone-owned file, or take `src/proxy.ts` off the owned list (Earmark carries the same unlisted file).
