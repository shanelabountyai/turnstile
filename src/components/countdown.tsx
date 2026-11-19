'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Display only (D-34): counts down from what the server computed and, at zero, asks the server again. It never
 * decides anything; the hold expires when the server's clock passes the inclusive second, whatever this shows.
 * The visible clock is a timer (not live, so it does not chatter); a separate polite region speaks once at two minutes
 * left and once at zero (design pass, a11y review). Holds cannot be extended: the TTL is a rule (D-39).
 */
export function Countdown({ seconds, label }: { seconds: number; label: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left === 0) router.refresh();
  }, [left, router]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const warn = left === 0 ? `Time is up on ${label}.` : left <= 120 && seconds > 120 ? `Two minutes or less left on ${label}.` : '';
  return (
    <>
      <span role="timer">{left > 0 ? `${mm}:${ss} left` : 'Time is up. Checking with the server…'}</span>
      <span className="sr-only" aria-live="polite">{warn}</span>
    </>
  );
}
