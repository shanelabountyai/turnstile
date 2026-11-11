'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { axisNow } from '@/checkout/clock';
import { eventByKey } from '@/checkout/read';
import { audit } from '@/core/audit';
import { orgAction } from '@/core/authz/action';
import { withOrg } from '@/core/db/rls';
import { isTimestamp, toSeconds, type Timestamp } from '@/inventory/time';

// D-35: staff set the event clock. Stored as an offset from the wall clock on the axis, so it keeps ticking; never set
// before the CommandLog's last command (the engine cannot run backwards). The server still decides every expiry (D-34).
export const setEventClock = orgAction(
  'org.update',
  z.object({
    event: z.string().min(1).max(64),
    // <input type="datetime-local" step="1"> drops ":00" seconds; put them back
    to: z.string().transform((s) => (s.length === 16 ? `${s}:00` : s)).refine(isTimestamp, 'Give the time as YYYY-MM-DDTHH:MM:SS.').optional(),
    reset: z.literal('1').optional(),
  }),
  async (ctx, i) => {
    const ev = await eventByKey(ctx.orgId, i.event);
    if (!ev) return { error: 'No such event in this organisation.' };
    const wall = axisNow(new Date(), ev.timezoneLabel);
    const target = (i.reset ? wall : i.to) as Timestamp | undefined;
    if (!target) return { error: 'Give the time as YYYY-MM-DDTHH:MM:SS.' };
    const last = await withOrg(ctx, (tx) => tx.commandLog.findFirst({ where: { eventId: ev.id }, orderBy: [{ at: 'desc' }, { cmdId: 'desc' }], select: { at: true } }), { atomic: false });
    if (last && target < last.at) return { error: `The log's last command is at ${last.at.replace('T', ' ')}; the event clock cannot go before it.` };
    const offset = toSeconds(target) - toSeconds(wall);
    await withOrg(ctx, async (tx) => {
      await tx.event.update({ where: { id: ev.id }, data: { clockOffsetSeconds: offset } });
      await audit(ctx, 'event.clock_set', { targetType: 'event', targetId: ev.id, data: { to: target, offsetSeconds: offset } }, tx);
    });
    redirect(`/o/${ctx.slug}/events/${ev.eventKey}`);
  },
);
