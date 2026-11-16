// inventory:eval (task 1.10): run the engine over fixtures/, print the brief §11 table, diff every row of the seven
// expected files, exit non-zero on the first difference. Printing and diffing live in inventory-report.ts (shared
// with inventory:eval:db, task 2.6).
import { existsSync } from 'node:fs';
import { Engine } from '../src/inventory/engine';
import { loadCommands, loadEvent } from '../src/inventory/load';
import { tables } from '../src/inventory/tables';
import { diffExpected, printReport } from './inventory-report';

const FX = process.argv[2] ?? 'fixtures';
if (!existsSync(`${FX}/commands.csv`)) {
  console.log('0 commands');
  process.exit(0);
}
const ev = loadEvent(FX);
const cmds = loadCommands(FX);
const e = new Engine(ev);
e.run(cmds);
const t = tables(e);
printReport(ev.name, t);
const failed = diffExpected(FX, t);
if (failed) {
  console.error(`DIFFERS: ${failed}`);
  process.exit(1);
}
console.log(`eval: 7 expected files and expected_summary.json match (${t.summary.commands} commands)`);
