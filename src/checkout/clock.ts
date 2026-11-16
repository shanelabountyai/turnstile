// "Now" on the event's axis (D-9): the one place a wall-clock instant becomes a YYYY-MM-DDTHH:MM:SS label, through
// the zone the event names. Not part of the engine; used by the routes (the webhook, Phase 3's UI) only.
import { compareStrings } from '@/inventory/canonical';
import { addSeconds, timestamp, type Timestamp } from '@/inventory/time';

export function axisNow(date: Date, timezoneLabel: string): Timestamp {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezoneLabel, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return timestamp(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`, 'now');
}

/** The event's clock (D-35): the wall clock on the axis plus the offset staff set. The server's "now" for every cast and screen. */
export const eventNow = (date: Date, ev: { timezoneLabel: string; clockOffsetSeconds: number }): Timestamp =>
  addSeconds(axisNow(date, ev.timezoneLabel), ev.clockOffsetSeconds);

/**
 * The `at` a new command is stamped with, so the CommandLog stays in (at, cmd_id) order (non-negotiable 1): the clock
 * if it is past the log's last command, else that command's second (when cmd_id sorts after it) or the next second.
 * Same rule readEvent uses for reads: the engine cannot run backwards.
 */
export function stampAfter(now: Timestamp, cmdId: string, last: { at: Timestamp; cmdId: string } | null): Timestamp {
  if (!last || compareStrings(now, last.at) > 0) return now;
  return compareStrings(cmdId, last.cmdId) > 0 ? last.at : addSeconds(last.at, 1);
}
