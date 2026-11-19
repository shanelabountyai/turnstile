'use client';
import { useEffect, useState } from 'react';

/**
 * Design pass (D-37, a11y review): a command's result arrives by redirect, as new DOM that a screen reader does not
 * announce. This live region is empty when it mounts and gets the text a moment later, which is what makes it speak.
 * Focus is not moved (the door keeps it in the code field for the next scan).
 */
export function Announce({ text, assertive }: { text: string; assertive?: boolean }) {
  const [said, setSaid] = useState('');
  useEffect(() => { const t = setTimeout(() => setSaid(text), 150); return () => clearTimeout(t); }, [text]);
  return <div className="sr-only" aria-live={assertive ? 'assertive' : 'polite'} aria-atomic="true">{said}</div>;
}
