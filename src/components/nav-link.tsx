'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** An org-bar link that marks itself current (aria-current, the underline in turnstile.css) for its path and below. */
export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return <Link href={href} aria-current={on ? 'page' : undefined}>{children}</Link>;
}
