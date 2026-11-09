// Canonical JSON and SHA-256 (task 1.3). Ported from Quorum src/tally/canonical.ts (its D-27, read 2026-11-09 from
// the public repo) with no changes below this header: one specification, Python's
// `json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=True)`, byte for byte, because the oracle
// (tools/inventorylib.py `canonical`) hashes that string and GT-01/GT-02/GQ-10 pin the result.
import { createHash } from 'node:crypto';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class CanonicalError extends Error {
  constructor(detail: string) {
    super(`canonical: ${detail}`);
    this.name = 'CanonicalError';
  }
}

/** Code-point order, which is what Python's `sorted()` on str gives (UTF-16 order agrees below U+10000). */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const sortedStrings = (xs: readonly string[]): string[] => [...xs].sort(compareStrings);

const SHORT: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

/** Python `json.dumps` string escaping with ensure_ascii: printable ASCII literal, everything else `\uXXXX` lowercase. */
export function quoteAscii(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const short = SHORT[ch];
    if (short !== undefined) out += short;
    else {
      const c = ch.charCodeAt(0);
      out += c >= 0x20 && c <= 0x7e ? ch : `\\u${c.toString(16).padStart(4, '0')}`;
    }
  }
  return out + '"';
}

/**
 * Serialize like Python with sorted keys and no whitespace. Refuses what Python would not write the same way or
 * what has no place in a ballot: floats, NaN, Infinity, undefined, functions, bigint. Integers print as digits.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new CanonicalError(`only integers are canonical, got ${String(value)}`);
    return String(value);
  }
  if (typeof value === 'string') return quoteAscii(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = sortedStrings(Object.keys(obj));
    return `{${keys.map((k) => `${quoteAscii(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  throw new CanonicalError(`${typeof value} is not canonical JSON`);
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
