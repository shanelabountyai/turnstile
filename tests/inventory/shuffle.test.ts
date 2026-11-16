// Task 1.11 / D-8: order independence. 20 seeded shuffles of the fixture commands → identical tables and commitment.
// The shuffle seed is fixed here (1 .. 20 via a small LCG) so a failure is reproducible.
import { describe, expect, it } from 'vitest';
import { Engine } from '@/inventory/engine';
import { loadCommands, loadEvent } from '@/inventory/load';
import { tables } from '@/inventory/tables';
import type { Command } from '@/inventory/types';

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
  for (let i = out.length - 1; i > 0; i--) { const j = next() % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

describe('order independence', () => {
  const ev = loadEvent('fixtures');
  const cmds: Command[] = loadCommands('fixtures');
  const base = new Engine(ev); base.run(cmds);
  const baseJson = JSON.stringify(tables(base));
  it('20 shuffles give the same tables and commitment', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const e = new Engine(ev);
      e.run(shuffled(cmds, seed));
      expect(JSON.stringify(tables(e)), `shuffle seed ${seed}`).toBe(baseJson);
    }
  });
  it('applying out of time order is refused, not silently reordered', () => {
    const e = new Engine(ev);
    e.apply(cmds[10]!);
    expect(() => e.apply(cmds[0]!)).toThrow(/INPUT_INVALID/);
  });
});
