'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { countdownWords } from './countdown-words';

const SAY = 'turnstile:countdown';

/**
 * Display only (D-34): counts down from what the server computed and, at zero, asks the server again. It never
 * decides anything; the hold expires when the server's clock passes the inclusive second, whatever this shows.
 * The visible clock is a timer (not live, so it does not chatter). It speaks once at two minutes left and once at zero
 * (design pass, a11y review; D-39) through the page's one <CountdownVoice>, not a region of its own: at zero the refresh
 * moves an expired hold out of the list and unmounts this component, and a region inside it went with it (PRD-4 item 16,
 * A11Y-2). Holds cannot be extended: the TTL is a rule (D-39). `label` is the hold id.
 */
export function Countdown({ seconds, label }: { seconds: number; label: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const warn = countdownWords(left, seconds, label);
  useEffect(() => {
    if (warn) window.dispatchEvent(new CustomEvent(SAY, { detail: warn }));
  }, [warn]);
  useEffect(() => {
    if (left === 0) router.refresh();
  }, [left, router]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return <span role="timer">{left > 0 ? `${mm}:${ss} left` : 'Time is up. Checking with the server…'}</span>;
}

/**
 * The polite live region the countdowns speak through. Rendered once per page, outside the list of holds, so it stays
 * mounted when a refresh removes an expired hold and its countdown (PRD-4 item 16).
 */
export function CountdownVoice() {
  const [said, setSaid] = useState('');
  useEffect(() => {
    const hear = (e: Event) => setSaid((e as CustomEvent<string>).detail);
    window.addEventListener(SAY, hear);
    return () => window.removeEventListener(SAY, hear);
  }, []);
  return <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="countdown-voice">{said}</div>;
}
