import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import { EmptyState, PageHeader, Section } from '@/components/ui';

export default async function Events({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const events = await withOrg({ orgId: ctx.orgId }, (tx) => tx.event.findMany({ where: { orgId: ctx.orgId }, orderBy: { startsAt: 'asc' }, select: { eventKey: true, name: true, venue: true, startsAt: true } }));
  return (
    <main>
      <PageHeader title="Events" />
      <Section id="list" title="All events">
        {events.length === 0 ? <EmptyState>No events loaded. Run <code>npm run turnstile:load -- --org {ctx.slug}</code>.</EmptyState> : (
          <ul>{events.map((e) => <li key={e.eventKey}><Link href={`/o/${ctx.slug}/events/${e.eventKey}`}>{e.name}</Link> · {e.venue} · {e.startsAt.replace('T', ' ')}</li>)}</ul>
        )}
      </Section>
    </main>
  );
}
