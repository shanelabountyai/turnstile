// "Now" on the event's axis (D-9): the one place a wall-clock instant becomes a YYYY-MM-DDTHH:MM:SS label, through
// the zone the event names. Not part of the engine; used by the routes (the webhook, Phase 3's UI) only.
import { timestamp, type Timestamp } from '@/inventory/time';

export function axisNow(date: Date, timezoneLabel: string): Timestamp {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezoneLabel, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return timestamp(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`, 'now');
}
