// The Turnstile component set (docs/DESIGN_SYSTEM.md). Server components, no state, no dependency: each one is a thin
// wrapper that fixes the markup so a page cannot drift from the system. Styles live in src/app/turnstile.css.
import Link from 'next/link';
import type { PillKind } from './pill';

export { Pill, type PillKind } from './pill';

/** The top of every page: what it is, what it says, and what you can do here. One <h1> per page. */
export function PageHeader({ eyebrow, title, lead, status, actions }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {status && <p className="cluster">{status}</p>}
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

/** A card with a heading. The heading is tied to the section for screen readers. */
export function Section({ id, title, aside, children }: { id: string; title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A figure, its label and what it is judged against. `k` colours the edge and is always backed by the sub text. */
export function Stat({ label, value, sub, k }: { label: string; value: React.ReactNode; sub?: React.ReactNode; k?: PillKind }) {
  return (
    <dl className="stat" data-k={k}>
      <dt>{label}</dt>
      <dd className="fig">{value}</dd>
      {sub && <dd className="sub">{sub}</dd>}
    </dl>
  );
}
export const Stats = ({ children }: { children: React.ReactNode }) => <div className="stats">{children}</div>;

/** A block message in a status family, headed by a glyph and a title. */
export function Notice({ k, title, children }: { k: PillKind; title: string; children?: React.ReactNode }) {
  return (
    <aside className="notice" data-k={k}>
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </aside>
  );
}

/** Nothing here yet: say so in a sentence and offer the next step. */
export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** A link that looks like a button. `secondary` for anything that is not the page's one main action. */
export function LinkButton({ href, variant, children }: { href: string; variant?: 'secondary' | 'ghost'; children: React.ReactNode }) {
  return <Link className={`button${variant ? ` ${variant}` : ''}`} href={href}>{children}</Link>;
}
