// PRD-4 (first impression and screen polish): display helpers for the Turnstile screens. Words and display only;
// nothing here decides anything, and the engine is not changed (src/inventory/ is only read by these tests).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { refusedPick, sectionOfPick, strandedBy, strandedWords } from '@/checkout/buy-view';
import { Engine } from '@/inventory/engine';
import { rowKey } from '@/inventory/event';

type Row = { row: string; seats: { seat: string; num: number; state: 'OPEN' | 'HELD' | 'SOLD' }[] };
const row = (id: string, taken: number[] = [], n = 12): Row => ({
  row: id,
  seats: Array.from({ length: n }, (_, i) => ({ seat: `A-${id}-${String(i + 1).padStart(2, '0')}`, num: i + 1, state: taken.includes(i + 1) ? 'SOLD' : 'OPEN' })),
});

describe('item 19: an orphan refusal carries the pick back and names the stranded seat', () => {
  const pick = (seats: unknown, code = 'ORPHAN_SEAT', kind = 'HOLD', status = 'REJECT') => refusedPick({ kind, status, code, payload: { seats } });
  it('the picked seats come back only for an ORPHAN_SEAT refusal of a HOLD', () => {
    expect(pick(['A-A-01', 'A-A-03'])).toEqual(['A-A-01', 'A-A-03']);
    expect(pick(['A-A-01'], 'SEAT_TAKEN')).toEqual([]);
    expect(pick(['A-A-01'], 'HELD', 'HOLD', 'OK')).toEqual([]);
    expect(pick('A-A-01')).toEqual([]);
    expect(pick([1, 'A-A-02'])).toEqual(['A-A-02']);
    expect(refusedPick(null)).toEqual([]);
  });
  it('1 and 3 of an empty row strand 2; a pick next to taken seats strands the gap it closes', () => {
    expect(strandedBy([row('A')], ['A-A-01', 'A-A-03'])).toEqual(['A-A-02']);
    expect(strandedBy([row('A', [5])], ['A-A-03'])).toEqual(['A-A-04']);
    expect(strandedBy([row('A', [5])], ['A-A-03', 'A-A-04'])).toEqual([]);
    expect(strandedBy([row('A', [2])], ['A-A-04', 'A-A-05'])).toEqual(['A-A-03']);
  });
  it('a row end is never stranded (no seat beyond it); an orphan that was already there is not blamed on the pick', () => {
    expect(strandedBy([row('A')], ['A-A-11'])).toEqual([]);
    expect(strandedBy([row('A', [1, 3])], ['A-A-05'])).toEqual(['A-A-04']);
  });
  it('picks in two rows are judged per row', () => {
    expect(strandedBy([row('A'), row('B')], ['A-A-01', 'A-A-03', 'A-B-05', 'A-B-07'])).toEqual(['A-A-02', 'A-B-06']);
  });
  it('agrees with the engine: the pick strands a seat exactly when the engine refuses it ORPHAN_SEAT', () => {
    // Every taken pattern of balcony row A-A (12 seats, the fixture event) against every pick of one or two open seats:
    // strandedBy(...) is non-empty exactly when Engine.createsOrphan(...) is true. The engine is only read here.
    const e = new Engine(JSON.parse(readFileSync('fixtures/event.json', 'utf8')));
    const ids = e.rows.get(rowKey('A', 'A'))!;
    expect(ids).toHaveLength(12);
    let checked = 0;
    for (let mask = 0; mask < 4096; mask++) {
      const taken = ids.filter((_, i) => mask & (1 << i));
      for (const id of ids) e.seats.get(id)!.state = taken.includes(id) ? 'SOLD' : 'OPEN';
      const r: Row = { row: 'A', seats: ids.map((id, i) => ({ seat: id, num: i + 1, state: taken.includes(id) ? 'SOLD' : 'OPEN' })) };
      const open = ids.filter((id) => !taken.includes(id));
      for (const p of [...open.map((a) => [a]), ...open.flatMap((a, i) => open.slice(i + 1).map((b) => [a, b]))]) {
        if ((strandedBy([r], p).length > 0) !== e.createsOrphan(p)) throw new Error(`disagree: taken ${taken.join(' ')} pick ${p.join(' ')}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(80_000);
  });
  it('the section shown is the one the refused pick was in', () => {
    const secs = [{ section: 'A', rows: [row('A')] }, { section: 'B', rows: [{ row: 'A', seats: [{ seat: 'B-A-01', num: 1, state: 'OPEN' as const }] }] }];
    expect(sectionOfPick(secs, ['B-A-01'])).toBe('B');
    expect(sectionOfPick(secs, ['A-A-01'])).toBe('A');
    expect(sectionOfPick(secs, [])).toBeUndefined();
    expect(sectionOfPick(secs, ['Z-Z-99'])).toBeUndefined();
  });
});

describe('item 19: the sentence that names the stranded seat', () => {
  it('one seat, two seats, none', () => {
    expect(strandedWords(['A-A-02'])).toBe('Seat A-A-02 would be left on its own.');
    expect(strandedWords(['A-A-02', 'A-B-06'])).toBe('Seats A-A-02 and A-B-06 would be left on their own.');
    expect(strandedWords(['A-A-02', 'A-A-05', 'A-B-06'])).toBe('Seats A-A-02, A-A-05 and A-B-06 would be left on their own.');
    expect(strandedWords([])).toBe('');
  });
});
