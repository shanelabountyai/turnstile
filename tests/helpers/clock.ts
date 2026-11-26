// Pin an event's clock to a fixed label on the axis, whatever today's date is (PRD-3 item 18: no test may depend on the
// calendar). A server action stamps its command at eventNow(new Date(), ev) = wall clock + clockOffsetSeconds (D-35), so
// a test that casts its own commands at fixed times and then calls an action must not leave the offset at 0: once the
// wall clock passes those times, the action lands after them (a 10-minute hold has expired) instead of at the log's end.
import { axisNow } from '@/checkout/clock';
import { db } from '@/core/db';
import { timestamp, toSeconds } from '@/inventory/time';

export async function pinEventClock(eventId: string, at: string): Promise<void> {
  const ev = await db.event.findUniqueOrThrow({ where: { id: eventId }, select: { timezoneLabel: true } });
  const clockOffsetSeconds = toSeconds(timestamp(at, 'at')) - toSeconds(axisNow(new Date(), ev.timezoneLabel));
  await db.event.update({ where: { id: eventId }, data: { clockOffsetSeconds } });
}
