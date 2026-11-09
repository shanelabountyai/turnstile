// inventory:lint (task 1.12; CLAUDE.md non-negotiables 1, 8). Exit 1 on the first failure, naming file and rule.
//   1. Nothing under src/inventory/ names Prisma, @/core, @/app, @/modules, Date.now, new Date(, Date.parse,
//      Math.random, random bytes, process.env, fetch, timers, stripe or anthropic — the engine is pure (D-8).
//   2. No float path under src/inventory/: parseFloat, toFixed, Math.round/floor/ceil, a decimal literal, or a
//      numeric `/ 100` / `/ 10000` (cents.ts divides in BigInt: `/ 10000n` is allowed).
//   3. fixtures/event.json parses against the closed schema (GT-13).
// Shape after Quorum scripts/tally-lint.ts (task 1.3).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseEvent } from '../src/inventory/event';

export const ENGINE_DIR = 'src/inventory';

const BANNED: [RegExp, string][] = [
  [/prisma/i, 'prisma (database)'],
  [/@\/core/, '@/core'],
  [/@\/app/, '@/app'],
  [/@\/modules/, '@/modules'],
  [/\bDate\.now\b/, 'Date.now (clock)'],
  [/\bnew\s+Date\s*\(/, 'new Date( (clock or axis crossing)'],
  [/\bDate\.parse\b/, 'Date.parse (axis crossing)'],
  [/\bMath\.random\b/, 'Math.random (randomness)'],
  [/\brandomUUID\b|\brandomBytes\b/, 'random bytes (randomness)'],
  [/\bprocess\.env\b/, 'process.env'],
  [/\bfetch\s*\(/, 'fetch (network)'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
  [/\bstripe\b/i, 'stripe (payment provider; belongs in src/checkout)'],
  [/anthropic/i, 'anthropic (model client)'],
  [/\bparseFloat\b/, 'parseFloat (float)'],
  [/\.toFixed\b/, 'toFixed (float)'],
  [/\bMath\.round\b|\bMath\.floor\b|\bMath\.ceil\b/, 'Math.round/floor/ceil (float rounding)'],
  [/\b\d+\.\d+\b/, 'a decimal literal (float)'],
  [/\/\s*100\b|\/\s*10000\b/, '/ 100 or / 10000 on a number (float on cents or bps)'],
];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export function lintEngineSource(path: string, source: string): string[] {
  const code = stripComments(source);
  return BANNED.filter(([re]) => re.test(code)).map(([, what]) => `${path}: ${what}`);
}

export function lintEngineDir(dir = ENGINE_DIR): string[] {
  if (!existsSync(dir)) return [`${dir}: missing`];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
    .map((d) => `${d.parentPath}/${d.name}`)
    .sort()
    .flatMap((p) => lintEngineSource(p, readFileSync(p, 'utf8')));
}

if (process.argv[1]?.endsWith('inventory-lint.ts')) {
  const problems = lintEngineDir();
  try {
    parseEvent(JSON.parse(readFileSync('fixtures/event.json', 'utf8')));
  } catch (e) {
    problems.push(`fixtures/event.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`inventory:lint OK (${readdirSync(ENGINE_DIR).length} files under ${ENGINE_DIR}; fixtures/event.json valid)`);
}
