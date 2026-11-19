import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { NavLink } from '@/components/nav-link';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
// Design pass (D-37): the org bar of the artboards (wordmark, org name, links); the event's own screens are a second
// row (EventTabs) on each event page. Module links keep their marker on their own line (foundation:check-modules).
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const base = `/o/${ctx.slug}`;
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <nav className="org-nav" aria-label="Organisation">
        <Link className="wordmark" href={`${base}/events`}>Turnstile</Link>
        <span className="assoc">{org.name}</span>
        <NavLink href={base} exact>Home</NavLink>
        <NavLink href={`${base}/events`}>Events</NavLink>
        <NavLink href={`${base}/projects`}>Projects</NavLink>
        <NavLink href={`${base}/settings/members`}>Members</NavLink>
        {can(ctx.role, 'audit.read') && <><NavLink href={`${base}/settings/audit`}>Audit log</NavLink><NavLink href={`${base}/settings/security`}>Security</NavLink></>}
        {ctx.role === 'owner' && <NavLink href={`${base}/settings/sso`}>SSO</NavLink>} {/* sso */}
        {can(ctx.role, 'apikeys.manage') && <NavLink href={`${base}/settings/apikeys`}>API keys</NavLink>} {/* apikeys */}
        {can(ctx.role, 'org.delete') && <NavLink href={`${base}/settings/danger`}>Export or delete</NavLink>}
        <span className="end"><Link href="/onboarding">Your orgs</Link><Link href="/account/security">Account</Link></span>
      </nav>
      {children}
    </>
  );
}
