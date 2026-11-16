'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Display only (D-34): counts down from what the server computed and, at zero, asks the server again. It never
 * decides anything; the hold expires when the server's clock passes the inclusive second, whatever this shows.
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
  return <span role="timer" aria-label={label}>{left > 0 ? `${mm}:${ss} left` : 'time is up; the server decides on the next request'}</span>;
}
