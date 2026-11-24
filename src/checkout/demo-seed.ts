// D-60 item 2: where a freshly loaded demo event's clock starts. One function, used by the build seed
// (scripts/seed-hosted.ts) and by the nightly reset (demo-reset.ts), so the two leave the same state.
import type { Tx } from '@/core/db/rls';
import { timestamp, toSeconds } from '@/inventory/time';
import { axisNow } from './clock';

/**
 * Put a freshly loaded event's clock at the moment its sales open, whatever the wall date. Before sales
 * open on the wall clock the offset is positive; after, negative. Used by the build seed and by the reset, so the two
 * leave the same state.
 */
export async function clockToSalesOpen(tx: Tx, eventId: string, wall: Date): Promise<number> {
  const ev = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { timezoneLabel: true, salesOpenAt: true } });
  const seconds = toSeconds(timestamp(ev.salesOpenAt, 'salesOpenAt')) - toSeconds(axisNow(wall, ev.timezoneLabel));
  await tx.event.update({ where: { id: eventId }, data: { clockOffsetSeconds: seconds } });
  return seconds;
}
