// The deployed demo's data (D-47). `scripts/vercel-build.mjs` runs this on a Vercel Production build after the
// migrations, when DEMO_MODE=1: the demo accounts (the template's seed, idempotent), then the fixture event into each
// demo org that does not have it yet (write-once, as turnstile:load). Safe to run on every build: a loaded event is
// never touched again, so nobody's holds, orders or event clock are reset by a deploy.
//
// On a fresh load only, the event clock (D-35) is set to the moment sales open when the wall clock is still before
// it, so the Buy screen can sell on the first visit; from then on the clock ticks and staff move it, as before.
// This is the same stored offset `setEventClock` writes; it is data on the event, not an engine rule.
import { pathToFileURL } from 'node:url';
import { axisNow } from '@/checkout/clock';
import { DEMO_ORGS } from '@/checkout/demo';
import { AlreadyLoaded, loadFixtureEvent } from '@/checkout/load';
import { db } from '@/core/db'; // importing it is what refuses a cloud database off Vercel (INV-18)
import { withOrg } from '@/core/db/rls';
import { timestamp, toSeconds } from '@/inventory/time';
import { seedDemo } from './seed-demo';

export { DEMO_ORGS }; // the two demo orgs now live in src/checkout/demo.ts, where the screens can read them (PRD-3 item 9)

export async function seedHosted(dir = 'fixtures', wall = new Date()): Promise<string[]> {
  const lines = await seedDemo();
  for (const slug of DEMO_ORGS) {
    const org = await db.org.findUniqueOrThrow({ where: { slug }, select: { id: true } });
    try {
      const r = await loadFixtureEvent(org.id, dir);
      const offset = await withOrg({ orgId: org.id }, async (tx) => {
        const ev = await tx.event.findUniqueOrThrow({ where: { id: r.eventId }, select: { timezoneLabel: true, salesOpenAt: true } });
        const now = axisNow(wall, ev.timezoneLabel);
        const opens = timestamp(ev.salesOpenAt, 'salesOpenAt');
        if (now >= opens) return 0; // sales are already open on the wall clock: leave the event on it
        const seconds = toSeconds(opens) - toSeconds(now);
        await tx.event.update({ where: { id: r.eventId }, data: { clockOffsetSeconds: seconds } });
        return seconds;
      });
      lines.push(`${slug}: loaded ${r.seats} seats and ${r.customers} customers; event clock ${offset ? 'set to the moment sales open' : 'left on the wall clock'}`);
    } catch (e) {
      if (!(e instanceof AlreadyLoaded)) throw e;
      lines.push(`${slug}: event already loaded, left as it is`);
    }
  }
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.DEMO_MODE !== '1') {
    console.error('seed-hosted: DEMO_MODE is not 1; nothing seeded.');
    process.exit(1);
  }
  const lines = await seedHosted();
  console.log(`seed-hosted: demo accounts and the fixture event are in place.\n  ${lines.join('\n  ')}`);
  await db.$disconnect();
}
