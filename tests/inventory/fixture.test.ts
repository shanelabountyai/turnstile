// Oracle agreement on the frozen fixtures (tasks 1.6–1.9, GQ-01..GQ-11): every row of the seven expected files and
// the commitment. The test reads expected_* — product code never does (non-negotiable 9).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/inventory/csv';
import { Engine } from '@/inventory/engine';
import { loadCommands, loadEvent } from '@/inventory/load';
import { COLUMNS, firstDiff, tables, type TableName } from '@/inventory/tables';

const FX = 'fixtures';
const ev = loadEvent(FX);
const cmds = loadCommands(FX);
const engine = new Engine(ev);
engine.run(cmds);
const got = tables(engine);
const want = (name: TableName) => parseCsv(readFileSync(`${FX}/${name}.csv`, 'utf8'), name);
const summary = JSON.parse(readFileSync(`${FX}/expected_summary.json`, 'utf8')) as typeof got.summary;

describe('fixture agreement (seed 20261109)', () => {
  it('GQ-01 commands / ok / rejected', () => {
    expect([got.summary.commands, got.summary.ok, got.summary.rejected]).toEqual([2662, 2510, 152]);
  });
  for (const name of Object.keys(COLUMNS) as TableName[]) {
    it(`${name}.csv matches row for row`, () => {
      expect(firstDiff(name, got[name], want(name), COLUMNS[name])).toBeNull();
    });
  }
  it('expected_summary.json matches, commitment included (GQ-10)', () => {
    expect(got.summary).toEqual(summary);
    expect(got.summary.commitment).toBe('d4d64203ae84f69cbc2b4e42e4297ac7dc01c151465dd147b7ce4638fef61d43');
  });
  it('GQ-04 end inventory: the pool is full while DOOR still shows allotment', () => {
    const door = got.expected_inventory.find((r) => r.id === 'DOOR')!;
    const floor = got.expected_inventory.find((r) => r.scope === 'pool' && r.id === 'FLOOR')!;
    expect([door.remaining, door.available, floor.sold, floor.remaining]).toEqual(['87', '0', '800', '0']);
  });
});
