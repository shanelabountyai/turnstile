'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { axisNow, eventNow } from '@/checkout/clock';
import { crossesSalesClose, wallClockBlock } from '@/checkout/demo';
import { WALL_CLOCK_BLOCKED } from '@/checkout/prd3-wording';
import { eventByKey } from '@/checkout/read';
import { CLOCK_MOVERS, refusingInline } from '@/checkout/refusal';
import { audit } from '@/core/audit';
import { demoEnabled } from '@/core/auth/demo';
import { orgAction } from '@/core/authz/action';
import { withOrg } from '@/core/db/rls';
import { compareStrings } from '@/inventory/canonical';
import { isTimestamp, toSeconds, type Timestamp } from '@/inventory/time';

// D-35: staff set the event clock. Stored as an offset from the wall clock on the axis, so it keeps ticking; never set
// before the CommandLog's last command (the engine cannot run backwards). The server still decides every expiry (D-34).
// A role without `org.update` is refused by the same guard as before, and told so on the form (D-65): the refusal is
// returned as `{ error }` instead of thrown to the app's error page.
// PRD-3 item 9: a move that takes the clock from before the close of sales to it or past it is one-way for the org, so
// it is not made on the first post: the action sends the caller to a confirmation on the Event page and writes nothing
// until `confirm=1` comes back. In demo mode "Back to the wall clock" is refused, in words, when it can only fail or
// would break the walk (wallClockBlock).
export const setEventClock = refusingInline(orgAction(
  'org.update',
  z.object({
    event: z.string().min(1).max(64),
    // <input type="datetime-local" step="1"> drops ":00" seconds; put them back
    to: z.string().transform((s) => (s.length === 16 ? `${s}:00` : s)).refine(isTimestamp, 'Give the time as YYYY-MM-DDTHH:MM:SS.').optional(),
    reset: z.literal('1').optional(),
    confirm: z.literal('1').optional(), // the answer to the one-way confirmation (PRD-3 item 9)
  }),
  async (ctx, i) => {
    const ev = await eventByKey(ctx.orgId, i.event);
    if (!ev) return { error: 'No such event in this organisation.' };
    const wall = axisNow(new Date(), ev.timezoneLabel);
    const target = (i.reset ? wall : i.to) as Timestamp | undefined;
    if (!target) return { error: 'Give the time as YYYY-MM-DDTHH:MM:SS.' };
    const last = await withOrg(ctx, (tx) => tx.commandLog.findFirst({ where: { eventId: ev.id }, orderBy: [{ at: 'desc' }, { cmdId: 'desc' }], select: { at: true } }), { atomic: false });
    if (last && target < last.at) return { error: `The log's last command is at ${last.at.replace('T', ' ')}; the event clock cannot go before it.` };
    // PRD-3 item 9. The clock a screen shows now: the stored clock, or the log's last command if that is later (as readEvent).
    const sales = await withOrg(ctx, (tx) => tx.event.findUniqueOrThrow({ where: { id: ev.id }, select: { salesOpenAt: true, salesCloseAt: true, cancelledAt: true } }), { atomic: false });
    const stored = eventNow(new Date(), ev);
    const asOf = last && compareStrings(stored, last.at) < 0 ? (last.at as Timestamp) : stored;
    const window = { salesOpenAt: sales.salesOpenAt as Timestamp, salesCloseAt: sales.salesCloseAt as Timestamp, cancelledAt: sales.cancelledAt as Timestamp | null };
    if (i.reset) {
      // The page does not offer the button in these cases; a post that arrives anyway gets the same sentence.
      const block = wallClockBlock({ ...window, demo: demoEnabled(), offsetSeconds: ev.clockOffsetSeconds, wall, asOf, logAt: (last?.at ?? null) as Timestamp | null });
      if (block) return { error: WALL_CLOCK_BLOCKED[block] };
    } else if (!i.confirm && crossesSalesClose(asOf, target, window.salesCloseAt)) {
      // One-way: this move closes sales. Nothing is written until the owner or admin confirms on the Event page.
      redirect(`/o/${ctx.slug}/events/${ev.eventKey}?confirm_clock=${target}#clock`);
    }
    const offset = toSeconds(target) - toSeconds(wall);
    await withOrg(ctx, async (tx) => {
      await tx.event.update({ where: { id: ev.id }, data: { clockOffsetSeconds: offset } });
      await audit(ctx, 'event.clock_set', { targetType: 'event', targetId: ev.id, data: { to: target, offsetSeconds: offset } }, tx);
    });
    redirect(`/o/${ctx.slug}/events/${ev.eventKey}`);
  },
), CLOCK_MOVERS);
