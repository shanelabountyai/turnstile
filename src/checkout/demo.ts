// The shared demo's own facts and the small decisions PRD-3 item 9 puts on screen (review UX-3, UX-4, UX-15; D-49,
// D-60). Pure: axis timestamps compared as strings (non-negotiable 8), no clock read here, nothing decided for the
// engine. The pages pass in the read model's `asOf`, the wall clock on the axis and whether DEMO_MODE is on.
import { compareStrings } from '@/inventory/canonical';
import type { Timestamp } from '@/inventory/time';

/** The template seed's two demo orgs; each gets its own copy of the fixture event (D-47). */
export const DEMO_ORGS = ['acme', 'globex'] as const;

/** Where a visitor is pointed when this org is spent: the other demo org. From any other org, the second one. */
export const otherDemoOrg = (slug: string): string => (slug === DEMO_ORGS[1] ? DEMO_ORGS[0] : DEMO_ORGS[1]);

type Sales = { salesOpenAt: Timestamp; salesCloseAt: Timestamp; cancelledAt: Timestamp | null };

/** Demo mode, not cancelled, and sales have closed on the event clock (the window is half-open: the closing second is closed). */
export const usedUp = (demo: boolean, v: Sales & { asOf: Timestamp }): boolean =>
  demo && !v.cancelledAt && compareStrings(v.asOf, v.salesCloseAt) >= 0;

/** A clock move that closes sales: from before `salesCloseAt` to it or later. This is the move that asks for confirmation. */
export const crossesSalesClose = (now: Timestamp, target: Timestamp, salesCloseAt: Timestamp): boolean =>
  compareStrings(now, salesCloseAt) < 0 && compareStrings(target, salesCloseAt) >= 0;

export type WallClockBlock = 'fails' | 'before-open' | 'closes-sales';

/**
 * Why "Back to the wall clock" is not offered in demo mode, or null when it is. `fails`: the wall clock is before the
 * log's last command, so the action can only refuse. `before-open`: it would take a clock that is inside the sales
 * window back to before sales open, where nothing can be bought. `closes-sales`: it would jump past the close of
 * sales and spend the org. An event already on the wall clock (offset 0) is never blocked: the press changes nothing.
 */
export function wallClockBlock(a: Sales & { demo: boolean; offsetSeconds: number; wall: Timestamp; asOf: Timestamp; logAt: Timestamp | null }): WallClockBlock | null {
  if (!a.demo || a.offsetSeconds === 0) return null;
  if (a.logAt && compareStrings(a.wall, a.logAt) < 0) return 'fails';
  if (compareStrings(a.wall, a.salesOpenAt) < 0 && compareStrings(a.asOf, a.salesOpenAt) >= 0) return 'before-open';
  if (crossesSalesClose(a.asOf, a.wall, a.salesCloseAt)) return 'closes-sales';
  return null;
}
