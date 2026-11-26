// What the countdown's polite region says (D-39; PRD-4 item 16). `label` is the hold id ("H-2AF305D1"), so the warning
// reads "Two minutes or less left on H-2AF305D1." and not "… left on time left on H-…" (A11Y-2). Spoken once at two
// minutes left (only when the hold started with more than that) and once at zero. Words only; nothing is decided here.
export function countdownWords(left: number, seconds: number, label: string): string {
  if (left === 0) return `Time is up on ${label}.`;
  return left <= 120 && seconds > 120 ? `Two minutes or less left on ${label}.` : '';
}
