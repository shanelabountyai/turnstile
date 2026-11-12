// npm run turnstile:cast -- --org <slug>: the 2,662 fixture commands into an org's loaded event (Stripe recorded), for the demo's end-of-night view.
import { parseArgs } from 'node:util';
import { db } from '@/core/db'; // importing it is what refuses a cloud database (INV-18)
import { castFixture } from './cast-fixture';

const { values } = parseArgs({ options: { org: { type: 'string' } } });
const org = values.org ? await db.org.findUnique({ where: { slug: values.org } }) : null;
if (!org) { console.error('usage: npm run turnstile:cast -- --org <slug>  (load the event first: turnstile:load)'); process.exit(2); }
const ev = await db.event.findFirst({ where: { orgId: org.id }, select: { id: true } });
if (!ev) { console.error(`no event in ${org.slug}; run turnstile:load first`); process.exit(2); }
if (await db.commandLog.count({ where: { orgId: org.id } })) { console.error('refused: commands already cast in this org'); process.exit(1); }
const { cmds } = await castFixture(org.id, ev.id);
console.log(`cast ${cmds.length} commands into ${org.slug}`);
await db.$disconnect();
