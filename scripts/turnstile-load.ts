// npm run turnstile:load -- --org <slug>: the fixture event into an org, write-once (task 2.3).
import { parseArgs } from 'node:util';
import { db } from '@/core/db'; // importing it is what refuses a cloud database (INV-18)
import { AlreadyLoaded, loadFixtureEvent } from '@/checkout/load';

const { values } = parseArgs({ options: { org: { type: 'string' }, dir: { type: 'string', default: 'fixtures' } } });
if (!values.org) {
  console.error('usage: npm run turnstile:load -- --org <slug> [--dir fixtures]');
  process.exit(2);
}
const org = await db.org.findUnique({ where: { slug: values.org } });
if (!org) {
  console.error(`no org with slug ${values.org}`);
  process.exit(2);
}
try {
  const r = await loadFixtureEvent(org.id, values.dir);
  console.log(`loaded into ${values.org}: event ${r.eventId}; ${r.pools} pools, ${r.tiers} tiers, ${r.sections} sections, ${r.seats} seats, ${r.customers} customers`);
} catch (e) {
  if (!(e instanceof AlreadyLoaded)) throw e;
  console.error(`refused: ${e.message}`);
  process.exit(1);
} finally {
  await db.$disconnect();
}
