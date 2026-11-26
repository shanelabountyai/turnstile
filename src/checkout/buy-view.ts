// PRD-4 items 17 and 19: what the Buy screen shows about the last command's result, worked out from the CommandLog row
// and the read model. Display only: nothing here casts, decides or changes a rule. The engine judges every pick
// (ORPHAN_SEAT, D-14, D-38); `strandedBy` only names, for the refusal's sentence, the seat the refused pick would have
// left on its own, read off the rows as the page shows them.

type Result = { kind: string; status: string; code: string; payload: unknown };
type SeatRow = { row: string; seats: { seat: string; state: string }[] };

const field = (payload: unknown, key: string): unknown =>
  payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;

/**
 * True when an accepted HOLD or PAY_START result names a hold that has since moved to another state: "Payment
 * started" once the order exists (UX-11, DES-11), "Held for you" once the hold expired. Such a banner is left off.
 */
export function movedOn(result: Result, holds: { hold: string; state: string }[]): boolean {
  if (result.status !== 'OK' || (result.kind !== 'HOLD' && result.kind !== 'PAY_START')) return false;
  const ref = field(result.payload, 'ref');
  const h = typeof ref === 'string' ? holds.find((x) => x.hold === ref) : undefined;
  return h !== undefined && h.state !== result.code;
}

/** The seats of a HOLD the engine refused with ORPHAN_SEAT, as the command carried them; [] for anything else. */
export function refusedPick(result: Result | null): string[] {
  if (!result || result.kind !== 'HOLD' || result.status !== 'REJECT' || result.code !== 'ORPHAN_SEAT') return [];
  const seats = field(result.payload, 'seats');
  return Array.isArray(seats) ? seats.filter((s): s is string => typeof s === 'string') : [];
}

/** The section that holds the first picked seat, so the refused pick is shown where it was made. */
export function sectionOfPick(sections: { section: string; rows: SeatRow[] }[], picked: string[]): string | undefined {
  return sections.find((s) => s.rows.some((r) => r.seats.some((st) => picked.includes(st.seat))))?.section;
}

/**
 * The open seats the pick would leave with a taken seat (or a picked one) on both sides in its row, that were not
 * already like that before the pick, in each row where the pick raises the number of such seats: the rule's own reading
 * of an orphan (brief §5, D-14), applied to the rows shown. A seat at a row end has nothing beyond it, so it is never
 * stranded.
 */
export function strandedBy(rows: SeatRow[], picked: string[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const before = r.seats.map((s) => s.state !== 'OPEN');
    const after = r.seats.map((s, i) => before[i] || picked.includes(s.seat));
    const alone = (occ: boolean[], i: number) => !occ[i] && i > 0 && i < occ.length - 1 && occ[i - 1] === true && occ[i + 1] === true;
    const was = r.seats.filter((_, i) => alone(before, i));
    const now = r.seats.filter((_, i) => alone(after, i));
    // the engine refuses a pick that raises the row's count of such seats (createsOrphan); name the new ones
    if (now.length > was.length) out.push(...now.filter((s) => !was.includes(s)).map((s) => s.seat));
  }
  return out;
}

/** The orphan refusal's extra sentence, naming the seat (UX-14). Proposed wording, for Shane (PRD-4, D-51). */
export function strandedWords(seats: string[]): string {
  if (seats.length === 0) return '';
  if (seats.length === 1) return `Seat ${seats[0]} would be left on its own.`;
  return `Seats ${seats.slice(0, -1).join(', ')} and ${seats[seats.length - 1]} would be left on their own.`;
}
