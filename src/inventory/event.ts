// P0-1 / D-2 / D-10: the event definition as data, validated against a closed schema. Anything outside it is
// RULES_INVALID naming the field (GT-13). Mirrors tools/inventorylib.py `validate_event`. Seats are minted here
// as `<section>-<row>-<nn>` (D-14).
import { z } from 'zod';
import { RulesInvalid } from './errors';
import { TIMESTAMP_RE, type Timestamp } from './time';

const ts = z.string().regex(TIMESTAMP_RE);
const nonneg = z.number().int().nonnegative();

const PoolSchema = z.object({ pool_id: z.string().min(1), kind: z.enum(['GA', 'RESERVED']), capacity: nonneg });
const TierSchema = z.object({
  tier_id: z.string().min(1), pool_id: z.string().min(1), allotment: nonneg, price_cents: nonneg,
  on_sale_at: ts, off_sale_at: ts,
});
const SectionSchema = z.object({ section_id: z.string().min(1), pool_id: z.string().min(1), rows: z.array(z.string().min(1)).min(1), seats_per_row: z.number().int().positive() });
const PolicyRowSchema = z.object({ min_days_before: nonneg, refund_bps: z.number().int().min(0).max(10000), fee_refunded: z.boolean() });
const RulesSchema = z.object({
  hold_ttl_minutes: nonneg, offer_ttl_minutes: nonneg, payment_timeout_minutes: nonneg, max_tickets_per_order: nonneg,
  prevent_orphan_seats: z.boolean(),
  waitlist_rule: z.literal('HEAD_BLOCKS'),
  offer_expired_rule: z.literal('DROP'),
  service_fee_cents: nonneg,
  refund_policy: z.array(PolicyRowSchema).min(1),
  cancellation_refund_bps: z.number().int().min(0).max(10000),
});
export const EventSchema = z.object({
  event_id: z.string().min(1), name: z.string(), venue: z.string(), timezone_label: z.string().min(1),
  starts_at: ts, doors_at: ts, sales_open_at: ts, sales_close_at: ts,
  currency: z.string().min(1), ticket_salt: z.string(),
  pools: z.array(PoolSchema).min(1), tiers: z.array(TierSchema).min(1), sections: z.array(SectionSchema).default([]),
  rules: RulesSchema,
});

export type Pool = z.infer<typeof PoolSchema>;
export type Tier = z.infer<typeof TierSchema> & { on_sale_at: Timestamp; off_sale_at: Timestamp };
export type Section = z.infer<typeof SectionSchema>;
export type PolicyRow = z.infer<typeof PolicyRowSchema>;
export type Rules = z.infer<typeof RulesSchema>;
export type EventDef = Omit<z.infer<typeof EventSchema>, 'tiers' | 'starts_at' | 'doors_at' | 'sales_open_at' | 'sales_close_at'> & {
  tiers: Tier[]; starts_at: Timestamp; doors_at: Timestamp; sales_open_at: Timestamp; sales_close_at: Timestamp;
};

/** Parse and cross-check an event definition; throws RulesInvalid with the offending field. */
export function parseEvent(raw: unknown): EventDef {
  const r = EventSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0]!;
    throw new RulesInvalid(issue.path.join('.') || '(root)', issue.message);
  }
  const ev = r.data;
  const pol = ev.rules.refund_policy;
  for (let i = 1; i < pol.length; i++) if (pol[i]!.min_days_before > pol[i - 1]!.min_days_before) throw new RulesInvalid('rules.refund_policy', 'rows must be sorted by min_days_before descending');
  if (pol[pol.length - 1]!.min_days_before !== 0) throw new RulesInvalid('rules.refund_policy', 'must end at 0 days');
  const pools = new Map(ev.pools.map((p) => [p.pool_id, p]));
  if (pools.size !== ev.pools.length) throw new RulesInvalid('pools', 'duplicate pool_id');
  const tierIds = new Set<string>();
  for (const t of ev.tiers) {
    if (tierIds.has(t.tier_id)) throw new RulesInvalid('tiers', `duplicate tier_id ${t.tier_id}`);
    tierIds.add(t.tier_id);
    if (!pools.has(t.pool_id)) throw new RulesInvalid(`tiers.${t.tier_id}.pool_id`, `unknown pool ${t.pool_id}`);
  }
  const seatCounts = new Map<string, number>();
  for (const s of ev.sections) {
    if (!pools.has(s.pool_id)) throw new RulesInvalid(`sections.${s.section_id}.pool_id`, `unknown pool ${s.pool_id}`);
    seatCounts.set(s.pool_id, (seatCounts.get(s.pool_id) ?? 0) + s.rows.length * s.seats_per_row);
  }
  for (const p of ev.pools) {
    if (p.kind === 'RESERVED') {
      if ((seatCounts.get(p.pool_id) ?? 0) !== p.capacity) throw new RulesInvalid(`pools.${p.pool_id}.capacity`, 'reserved capacity must equal its seat count');
      const tiers = ev.tiers.filter((t) => t.pool_id === p.pool_id);
      if (tiers.length !== 1) throw new RulesInvalid(`pools.${p.pool_id}`, 'a reserved pool needs exactly one tier');
    }
  }
  return ev as unknown as EventDef;
}

export type SeatState = 'OPEN' | 'HELD' | 'SOLD';
export interface Seat {
  seat_id: string; section: string; row: string; num: number; tier: string; pool: string;
  state: SeatState; hold_id: string | null; ticket_id: string | null;
}

export const seatId = (section: string, row: string, n: number): string => `${section}-${row}-${String(n).padStart(2, '0')}`;

/** Mint every seat of every section; rows keyed `${section}\u0000${row}` keep seat order. */
export function mintSeats(ev: EventDef): { seats: Map<string, Seat>; rows: Map<string, string[]> } {
  const seats = new Map<string, Seat>();
  const rows = new Map<string, string[]>();
  for (const sec of ev.sections) {
    const tier = ev.tiers.find((t) => t.pool_id === sec.pool_id)!;
    for (const row of sec.rows) {
      const ids: string[] = [];
      for (let n = 1; n <= sec.seats_per_row; n++) {
        const id = seatId(sec.section_id, row, n);
        seats.set(id, { seat_id: id, section: sec.section_id, row, num: n, tier: tier.tier_id, pool: sec.pool_id, state: 'OPEN', hold_id: null, ticket_id: null });
        ids.push(id);
      }
      rows.set(rowKey(sec.section_id, row), ids);
    }
  }
  return { seats, rows };
}

export const rowKey = (section: string, row: string): string => `${section}\u0000${row}`;
