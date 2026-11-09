// Fixture loaders (task 1.4). Read-only: product code never writes to fixtures/ and never reads answer_key.csv or
// expected_* — only scripts/inventory-eval.ts does (non-negotiable 9).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv';
import { InputInvalid } from './errors';
import { parseEvent, type EventDef } from './event';
import { timestamp } from './time';
import type { Command } from './types';

export function loadEvent(dir: string): EventDef {
  return parseEvent(JSON.parse(readFileSync(join(dir, 'event.json'), 'utf8')));
}

export function parseCommandRow(r: Record<string, string>, n: number): Command {
  const field = `commands.csv:${n}`;
  const qty = r.qty === '' || r.qty === undefined ? 0 : Number(r.qty);
  if (!Number.isSafeInteger(qty)) throw new InputInvalid(`${field}.qty`, `not an integer: ${r.qty}`);
  return {
    cmd_id: r.cmd_id ?? '', at: timestamp(r.at, `${field}.at`), kind: r.kind ?? '', customer: r.customer ?? '', ref: r.ref ?? '',
    tier_id: r.tier_id ?? '', qty, seats: r.seats ? r.seats.split(' ').filter(Boolean) : [], payment_id: r.payment_id ?? '',
    target: r.target ?? '', tickets: r.tickets ? r.tickets.split(' ').filter(Boolean) : [], note: r.note ?? '',
  };
}

export function loadCommands(dir: string): Command[] {
  return parseCsv(readFileSync(join(dir, 'commands.csv'), 'utf8'), 'commands.csv').map((r, i) => parseCommandRow(r, i + 2));
}
