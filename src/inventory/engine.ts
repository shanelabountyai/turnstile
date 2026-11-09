// The inventory engine (P0-2..P0-7), written from docs/domain-brief.md §4–§8. Pure: no database, clock, randomness,
// network, Stripe or model client (inventory:lint). Commands are evaluated in (at, cmd_id) order; `advance(at)` runs
// before every command (D-8). It must agree with tools/inventorylib.py on every command, every count, every table
// and the commitment — the oracle is the spec's executable form, this is the product's.
import { canonicalJson, compareStrings, sha256Hex, sortedStrings } from './canonical';
import { applyBps } from './cents';
import { KINDS, Reject, type Kind } from './codes';
import { InputInvalid } from './errors';
import { mintSeats, parseEvent, rowKey, type EventDef, type PolicyRow, type Seat, type Section, type Tier } from './event';
import { addMinutes, daysBefore, timestamp, type Timestamp } from './time';
import type { Command, Hold, InventoryRow, Order, Payment, Refund, Result, Summary, Ticket, WaitlistEntry } from './types';

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

export class Engine {
  readonly ev: EventDef;
  readonly pools: Map<string, EventDef['pools'][number]>;
  readonly tiers: Map<string, Tier>;
  readonly sections: Map<string, Section>;
  readonly seats: Map<string, Seat>;
  readonly rows: Map<string, string[]>;
  readonly holds = new Map<string, Hold>();
  readonly payments = new Map<string, Payment>();
  readonly orders = new Map<string, Order>();
  readonly tickets = new Map<string, Ticket>();
  readonly waitlist: WaitlistEntry[] = [];
  readonly refunds: Refund[] = [];
  readonly results: Result[] = [];
  cancelledAt: Timestamp | null = null;
  private nOrder = 0;
  private nTicket = 0;
  private nEntry = 0;
  private nOffer = 0;
  private nRefund = 0;
  private readonly seenCmd = new Set<string>();
  private now: Timestamp | null = null;

  constructor(event: unknown) {
    this.ev = parseEvent(event); // RULES_INVALID here, never later (GT-13)
    this.pools = new Map(this.ev.pools.map((p) => [p.pool_id, p]));
    this.tiers = new Map(this.ev.tiers.map((t) => [t.tier_id, t]));
    this.sections = new Map(this.ev.sections.map((s) => [s.section_id, s]));
    const minted = mintSeats(this.ev);
    this.seats = minted.seats;
    this.rows = minted.rows;
  }

  // ------------------------------------------------------------------ counts (D-11)
  tierSold(tierId: string): number {
    let n = 0;
    for (const t of this.tickets.values()) if (t.tier === tierId && (t.state === 'ISSUED' || t.state === 'CHECKED_IN')) n++;
    return n;
  }
  tierHeld(tierId: string): number {
    let n = 0;
    for (const h of this.holds.values()) if (h.tier === tierId && (h.state === 'HELD' || h.state === 'PAYING')) n += h.qty;
    return n;
  }
  poolUsed(poolId: string): number {
    let n = 0;
    for (const [id, t] of this.tiers) if (t.pool_id === poolId) n += this.tierSold(id) + this.tierHeld(id);
    return n;
  }
  poolRemaining(poolId: string): number { return this.pools.get(poolId)!.capacity - this.poolUsed(poolId); }
  tierRemaining(tierId: string): number { const t = this.tiers.get(tierId)!; return t.allotment - this.tierSold(tierId) - this.tierHeld(tierId); }
  available(tierId: string): number { return Math.min(this.tierRemaining(tierId), this.poolRemaining(this.tiers.get(tierId)!.pool_id)); }
  tierOnSale(tierId: string, at: Timestamp): boolean { const t = this.tiers.get(tierId)!; return t.on_sale_at <= at && at < t.off_sale_at; }

  // ------------------------------------------------------------------ seats (D-14)
  orphansInRow(key: string, occupiedExtra: ReadonlySet<string> = new Set()): number {
    const ids = this.rows.get(key)!;
    const occ = ids.map((s) => this.seats.get(s)!.state !== 'OPEN' || occupiedExtra.has(s));
    let n = 0;
    for (let i = 0; i < occ.length; i++) {
      if (occ[i]) continue;
      const left = i > 0 ? occ[i - 1] : null;
      const right = i + 1 < occ.length ? occ[i + 1] : null;
      if (left === true && right === true) n++;
    }
    return n;
  }
  createsOrphan(seatIds: readonly string[]): boolean {
    if (!this.ev.rules.prevent_orphan_seats) return false;
    const byRow = new Map<string, string[]>();
    for (const s of seatIds) {
      const st = this.seats.get(s)!;
      const k = rowKey(st.section, st.row);
      byRow.set(k, [...(byRow.get(k) ?? []), s]);
    }
    for (const [k, ss] of byRow) if (this.orphansInRow(k, new Set(ss)) > this.orphansInRow(k)) return true;
    return false;
  }
  /** Lowest row, lowest start of `qty` OPEN contiguous seats that creates no orphan; null when none fits. */
  contiguousBlock(sectionId: string, qty: number): string[] | null {
    const sec = this.sections.get(sectionId)!;
    for (const row of sec.rows) {
      const ids = this.rows.get(rowKey(sectionId, row))!;
      for (let start = 0; start + qty <= ids.length; start++) {
        const block = ids.slice(start, start + qty);
        if (block.every((s) => this.seats.get(s)!.state === 'OPEN') && !this.createsOrphan(block)) return block;
      }
    }
    return null;
  }
  sectionCanServe(sectionId: string, qty: number): boolean { return this.contiguousBlock(sectionId, qty) !== null; }

  // ------------------------------------------------------------------ tick (D-8, D-12, W-5)
  advance(at: Timestamp): void {
    let changed = false;
    const ordered = [...this.holds.values()].sort((a, b) => compareStrings(a.expires_at, b.expires_at) || compareStrings(a.hold_id, b.hold_id));
    for (const h of ordered) {
      if (h.state === 'HELD' && h.expires_at <= at) {
        this.setHoldState(h, 'EXPIRED', at);
        if (h.kind === 'OFFER') { const e = this.entry(h.entry_id!); e.state = 'OFFER_EXPIRED'; e.ended_at = at; }
        changed = true;
      } else if (h.state === 'PAYING' && h.pay_timeout_at! <= at) {
        this.setHoldState(h, 'PAY_TIMEOUT', at);
        changed = true;
      }
    }
    for (const e of this.waitlist) {
      const t = this.tiers.get(e.target);
      if (e.state === 'WAITING' && t && t.off_sale_at <= at) { e.state = 'CLOSED_OFF_SALE'; e.ended_at = t.off_sale_at; }
    }
    if (changed) this.fillWaitlist(at);
  }

  private setHoldState(h: Hold, state: Hold['state'], at: Timestamp): void {
    h.state = state;
    h.ended_at = at;
    if (state === 'EXPIRED' || state === 'RELEASED' || state === 'PAY_FAILED' || state === 'PAY_TIMEOUT' || state === 'CANCELLED') {
      for (const s of h.seats) {
        const st = this.seats.get(s)!;
        if (st.hold_id === h.hold_id && st.state === 'HELD') { st.state = 'OPEN'; st.hold_id = null; }
      }
    }
  }

  private entry(entryId: string): WaitlistEntry {
    const e = this.waitlist.find((x) => x.entry_id === entryId);
    if (!e) throw new InputInvalid('entry_id', entryId);
    return e;
  }

  // ------------------------------------------------------------------ waitlist fill (D-15, W-4)
  fillWaitlist(at: Timestamp): void {
    if (this.cancelledAt) return;
    const targets = sortedStrings([...new Set(this.waitlist.filter((e) => e.state === 'WAITING').map((e) => e.target))]);
    for (const target of targets) {
      for (;;) {
        const waiting = this.waitlist.filter((e) => e.target === target && e.state === 'WAITING')
          .sort((a, b) => compareStrings(a.joined_at, b.joined_at) || compareStrings(a.entry_id, b.entry_id));
        if (waiting.length === 0) break;
        const head = waiting[0]!;
        let seats: string[] = [];
        let tierId: string;
        if (this.tiers.has(target)) {
          if (!this.tierOnSale(target, at)) break;
          if (this.available(target) < head.qty) break;
          tierId = target;
        } else {
          const block = this.contiguousBlock(target, head.qty);
          if (block === null) break;
          seats = block;
          tierId = this.seats.get(block[0]!)!.tier;
        }
        this.nOffer++;
        const hid = `O-${pad(this.nOffer, 4)}`;
        this.createHold(hid, 'OFFER', head.customer, tierId, head.qty, seats, at, addMinutes(at, this.ev.rules.offer_ttl_minutes), head.entry_id);
        head.state = 'OFFERED';
        head.offer_id = hid;
        head.offered_at = at;
      }
    }
  }

  private createHold(hid: string, kind: 'HOLD' | 'OFFER', customer: string, tierId: string, qty: number, seats: string[], at: Timestamp, expiresAt: Timestamp, entryId: string | null = null): Hold {
    const t = this.tiers.get(tierId)!;
    const h: Hold = {
      hold_id: hid, kind, customer, tier: tierId, qty, seats: [...seats], state: 'HELD', created_at: at, expires_at: expiresAt,
      price_cents: t.price_cents, fee_cents: this.ev.rules.service_fee_cents, payment_id: null, pay_started_at: null, pay_timeout_at: null,
      entry_id: entryId, order_id: null, ended_at: null,
    };
    for (const s of seats) { const st = this.seats.get(s)!; st.state = 'HELD'; st.hold_id = hid; }
    this.holds.set(hid, h);
    return h;
  }

  // ------------------------------------------------------------------ commands
  run(commands: readonly Command[]): Result[] {
    const ordered = [...commands].sort((a, b) => compareStrings(a.at, b.at) || compareStrings(a.cmd_id, b.cmd_id));
    for (const c of ordered) this.apply(c);
    return this.results;
  }

  apply(c: Command): Result {
    const at = timestamp(c.at, `${c.cmd_id}.at`);
    if (this.now !== null && at < this.now) throw new InputInvalid(c.cmd_id, 'commands must be applied in time order');
    if (this.seenCmd.has(c.cmd_id)) throw new InputInvalid(c.cmd_id, 'duplicate cmd_id');
    this.seenCmd.add(c.cmd_id);
    this.now = at;
    this.advance(at);
    let status: Result['status'] = 'OK';
    let code: string;
    let detail: string;
    try {
      [code, detail] = this.dispatch(c);
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      status = 'REJECT';
      code = e.rejectCode;
      detail = e.detail;
    }
    const res: Result = { cmd_id: c.cmd_id, at, kind: c.kind, customer: c.customer ?? '', status, code, detail };
    this.results.push(res);
    return res;
  }

  private dispatch(c: Command): [string, string] {
    const k = c.kind as Kind;
    if (!(KINDS as readonly string[]).includes(k)) throw new Reject('KIND_UNKNOWN', c.kind);
    if (k === 'CANCEL_EVENT') return this.cmdCancel(c);
    if (this.cancelledAt !== null) {
      if (k === 'PAY_SUCCEEDED') return this.cmdPaySucceeded(c); // late webhooks after cancel are handled, not rejected
      throw new Reject('EVENT_CANCELLED');
    }
    switch (k) {
      case 'HOLD': return this.cmdHold(c);
      case 'RELEASE': return this.cmdRelease(c);
      case 'PAY_START': return this.cmdPayStart(c);
      case 'PAY_SUCCEEDED': return this.cmdPaySucceeded(c);
      case 'PAY_FAILED': return this.cmdPayFailed(c);
      case 'WAITLIST_JOIN': return this.cmdWaitlistJoin(c);
      case 'WAITLIST_LEAVE': return this.cmdWaitlistLeave(c);
      case 'REFUND_REQUEST': return this.cmdRefund(c);
      case 'CHECK_IN': return this.cmdCheckIn(c);
    }
  }

  private salesWindow(at: Timestamp): void {
    if (at < this.ev.sales_open_at) throw new Reject('SALES_NOT_OPEN');
    if (at >= this.ev.sales_close_at) throw new Reject('SALES_CLOSED');
  }

  // H-1..H-13
  private cmdHold(c: Command): [string, string] {
    const at = c.at;
    this.salesWindow(at);
    const tierId = c.tier_id ?? '';
    const tier = this.tiers.get(tierId);
    if (!tier) throw new Reject('TIER_UNKNOWN', tierId);
    if (!this.tierOnSale(tierId, at)) throw new Reject('TIER_NOT_ON_SALE', tierId);
    const hid = c.ref;
    if (this.holds.has(hid)) throw new Reject('HOLD_ID_DUPLICATE', hid);
    const pool = this.pools.get(tier.pool_id)!;
    const seats = c.seats ?? [];
    let qty = c.qty || 0;
    if (pool.kind === 'RESERVED') {
      if (seats.length === 0) throw new Reject('SEATS_REQUIRED');
      qty = seats.length;
    } else if (seats.length > 0) throw new Reject('SEATS_NOT_ALLOWED');
    if (qty < 1) throw new Reject('QTY_INVALID', String(qty));
    if (qty > this.ev.rules.max_tickets_per_order) throw new Reject('QTY_OVER_LIMIT', String(qty));
    if (pool.kind === 'RESERVED') {
      if (new Set(seats).size !== seats.length) throw new Reject('SEAT_DUPLICATE');
      for (const s of seats) {
        const st = this.seats.get(s);
        if (!st) throw new Reject('SEAT_UNKNOWN', s);
        if (st.tier !== tierId) throw new Reject('SEAT_TIER_MISMATCH', s);
      }
      const taken = seats.filter((s) => this.seats.get(s)!.state !== 'OPEN');
      if (taken.length) throw new Reject('SEAT_TAKEN', sortedStrings(taken).join(' '));
      if (this.createsOrphan(seats)) throw new Reject('ORPHAN_SEAT');
    } else {
      if (this.poolRemaining(pool.pool_id) < qty) throw new Reject('SOLD_OUT_POOL', `pool=${this.poolRemaining(pool.pool_id)} tier=${this.tierRemaining(tierId)}`);
      if (this.tierRemaining(tierId) < qty) throw new Reject('SOLD_OUT_TIER', `tier=${this.tierRemaining(tierId)} pool=${this.poolRemaining(pool.pool_id)}`);
    }
    this.createHold(hid, 'HOLD', c.customer, tierId, qty, seats, at, addMinutes(at, this.ev.rules.hold_ttl_minutes));
    return ['HELD', hid];
  }

  private getHold(c: Command): Hold {
    const h = this.holds.get(c.ref ?? '');
    if (!h) throw new Reject('HOLD_UNKNOWN', c.ref ?? '');
    if (h.customer !== c.customer) throw new Reject('HOLD_NOT_YOURS', h.hold_id);
    return h;
  }

  private requireHeld(h: Hold): void {
    if (h.state === 'EXPIRED') throw new Reject('HOLD_EXPIRED', h.hold_id);
    if (h.state === 'RELEASED') throw new Reject('HOLD_RELEASED', h.hold_id);
    if (h.state !== 'HELD') throw new Reject('HOLD_NOT_HELD', h.state);
  }

  // H-14
  private cmdRelease(c: Command): [string, string] {
    const h = this.getHold(c);
    this.requireHeld(h);
    this.setHoldState(h, 'RELEASED', c.at);
    if (h.kind === 'OFFER') { const e = this.entry(h.entry_id!); e.state = 'OFFER_DECLINED'; e.ended_at = c.at; }
    this.fillWaitlist(c.at);
    return ['RELEASED', h.hold_id];
  }

  // P-1..P-3
  private cmdPayStart(c: Command): [string, string] {
    const h = this.getHold(c);
    this.requireHeld(h);
    const pid = c.payment_id ?? '';
    if (this.payments.has(pid)) throw new Reject('PAYMENT_ID_DUPLICATE', pid);
    h.state = 'PAYING';
    h.payment_id = pid;
    h.pay_started_at = c.at;
    h.pay_timeout_at = addMinutes(c.at, this.ev.rules.payment_timeout_minutes);
    const amount = h.qty * (h.price_cents + h.fee_cents);
    this.payments.set(pid, { payment_id: pid, hold_id: h.hold_id, amount_cents: amount, state: 'PENDING', started_at: c.at, ended_at: null });
    return ['PAYING', `${pid} ${amount}`];
  }

  // P-5..P-7
  private cmdPaySucceeded(c: Command): [string, string] {
    const pid = c.payment_id ?? '';
    const p = this.payments.get(pid);
    if (!p) throw new Reject('PAYMENT_UNKNOWN', pid);
    if (p.state !== 'PENDING') return ['PAYMENT_DUPLICATE', pid];
    const h = this.holds.get(p.hold_id)!;
    p.ended_at = c.at;
    if (h.state === 'PAY_TIMEOUT') {
      p.state = 'SUCCEEDED_LATE';
      const rid = this.refund(null, null, p.amount_cents, 'PAID_AFTER_TIMEOUT', c.at, pid);
      return ['PAID_AFTER_TIMEOUT', `${rid} ${p.amount_cents}`];
    }
    if (h.state === 'CANCELLED') {
      p.state = 'SUCCEEDED_LATE';
      const rid = this.refund(null, null, p.amount_cents, 'PAID_AFTER_CANCEL', c.at, pid);
      return ['PAID_AFTER_CANCEL', `${rid} ${p.amount_cents}`];
    }
    if (h.state !== 'PAYING') throw new Reject('HOLD_NOT_HELD', h.state);
    p.state = 'SUCCEEDED';
    this.nOrder++;
    const oid = `ORD-${pad(this.nOrder, 5)}`;
    const tids: string[] = [];
    for (let i = 0; i < h.qty; i++) {
      this.nTicket++;
      const tid = `T-${pad(this.nTicket, 5)}`;
      const seat = h.seats.length ? h.seats[i]! : '';
      this.tickets.set(tid, {
        ticket_id: tid, order_id: oid, tier: h.tier, seat, price_cents: h.price_cents, fee_cents: h.fee_cents, state: 'ISSUED',
        issued_at: c.at, checked_in_at: null, refunded_cents: 0,
        code: sha256Hex(`${this.ev.event_id}|${tid}|${this.ev.ticket_salt}`).slice(0, 20),
      });
      if (seat) { const st = this.seats.get(seat)!; st.state = 'SOLD'; st.hold_id = null; st.ticket_id = tid; }
      tids.push(tid);
    }
    this.orders.set(oid, {
      order_id: oid, customer: h.customer, tier: h.tier, qty: h.qty, seats: [...h.seats], gross_cents: h.qty * h.price_cents,
      fees_cents: h.qty * h.fee_cents, payment_id: pid, confirmed_at: c.at, tickets: tids, hold_id: h.hold_id, via_offer: h.kind === 'OFFER',
    });
    h.state = 'CONFIRMED';
    h.order_id = oid;
    h.ended_at = c.at;
    if (h.kind === 'OFFER') { const e = this.entry(h.entry_id!); e.state = 'FULFILLED'; e.ended_at = c.at; e.order_id = oid; }
    return ['CONFIRMED', `${oid} ${tids.join(' ')}`];
  }

  // P-8
  private cmdPayFailed(c: Command): [string, string] {
    const pid = c.payment_id ?? '';
    const p = this.payments.get(pid);
    if (!p) throw new Reject('PAYMENT_UNKNOWN', pid);
    if (p.state !== 'PENDING') return ['PAYMENT_DUPLICATE', pid];
    const h = this.holds.get(p.hold_id)!;
    p.state = 'FAILED';
    p.ended_at = c.at;
    if (h.state === 'PAYING') {
      this.setHoldState(h, 'PAY_FAILED', c.at);
      if (h.kind === 'OFFER') { const e = this.entry(h.entry_id!); e.state = 'OFFER_PAY_FAILED'; e.ended_at = c.at; }
      this.fillWaitlist(c.at);
    }
    return ['PAYMENT_FAILED_RELEASED', h.hold_id];
  }

  // W-1..W-3
  private cmdWaitlistJoin(c: Command): [string, string] {
    const at = c.at;
    this.salesWindow(at);
    const target = c.target ?? '';
    const qty = c.qty || 0;
    if (this.tiers.has(target)) {
      if (!this.tierOnSale(target, at)) throw new Reject('TIER_NOT_ON_SALE', target);
      if (this.pools.get(this.tiers.get(target)!.pool_id)!.kind !== 'GA') throw new Reject('WAITLIST_TARGET_UNKNOWN', target);
    } else if (!this.sections.has(target)) throw new Reject('WAITLIST_TARGET_UNKNOWN', target);
    if (qty < 1) throw new Reject('QTY_INVALID', String(qty));
    if (qty > this.ev.rules.max_tickets_per_order) throw new Reject('QTY_OVER_LIMIT', String(qty));
    if (this.tiers.has(target)) {
      if (this.available(target) >= qty) throw new Reject('WAITLIST_NOT_NEEDED', `available=${this.available(target)}`);
    } else if (this.sectionCanServe(target, qty)) throw new Reject('WAITLIST_NOT_NEEDED', 'block available');
    for (const e of this.waitlist) {
      if (e.customer === c.customer && e.target === target && (e.state === 'WAITING' || e.state === 'OFFERED')) throw new Reject('WAITLIST_DUPLICATE', e.entry_id);
    }
    this.nEntry++;
    const eid = `W-${pad(this.nEntry, 4)}`;
    this.waitlist.push({ entry_id: eid, customer: c.customer, target, qty, joined_at: at, state: 'WAITING', offer_id: null, offered_at: null, ended_at: null, order_id: null });
    return ['WAITLISTED', eid];
  }

  // W-7
  private cmdWaitlistLeave(c: Command): [string, string] {
    const eid = c.ref ?? '';
    const e = this.waitlist.find((x) => x.entry_id === eid);
    if (!e) throw new Reject('WAITLIST_UNKNOWN', eid);
    if (e.customer !== c.customer) throw new Reject('WAITLIST_NOT_YOURS', eid);
    if (e.state !== 'WAITING' && e.state !== 'OFFERED') throw new Reject('WAITLIST_UNKNOWN', `${eid} ${e.state}`);
    if (e.state === 'OFFERED') {
      const h = this.holds.get(e.offer_id!)!;
      if (h.state === 'HELD') this.setHoldState(h, 'RELEASED', c.at);
      else if (h.state === 'PAYING') throw new Reject('HOLD_NOT_HELD', 'PAYING'); // resolves by webhook
    }
    e.state = 'LEFT';
    e.ended_at = c.at;
    this.fillWaitlist(c.at);
    return ['WAITLIST_LEFT', eid];
  }

  // R-3
  refundTerms(at: Timestamp): [number, PolicyRow] {
    const d = daysBefore(this.ev.starts_at, at);
    for (const p of this.ev.rules.refund_policy) if (d >= p.min_days_before) return [d, p];
    return [d, this.ev.rules.refund_policy[this.ev.rules.refund_policy.length - 1]!];
  }

  private refund(orderId: string | null, ticketId: string | null, amount: number, reason: string, at: Timestamp, paymentId: string | null = null): string {
    this.nRefund++;
    const rid = `R-${pad(this.nRefund, 5)}`;
    this.refunds.push({
      refund_id: rid, order_id: orderId ?? '', ticket_id: ticketId ?? '',
      payment_id: paymentId ?? (orderId ? this.orders.get(orderId)!.payment_id : ''),
      amount_cents: amount, reason, at,
    });
    return rid;
  }

  // R-1..R-5
  private cmdRefund(c: Command): [string, string] {
    const oid = c.ref ?? '';
    const o = this.orders.get(oid);
    if (!o) throw new Reject('ORDER_UNKNOWN', oid);
    if (o.customer !== c.customer) throw new Reject('ORDER_NOT_YOURS', oid);
    const tids = c.tickets ?? [];
    if (tids.length === 0) throw new Reject('TICKET_NOT_IN_ORDER', '(none)');
    for (const tid of tids) if (!o.tickets.includes(tid)) throw new Reject('TICKET_NOT_IN_ORDER', tid);
    for (const tid of tids) {
      const t = this.tickets.get(tid)!;
      if (t.state === 'REFUNDED') throw new Reject('TICKET_ALREADY_REFUNDED', tid);
      if (t.state === 'CHECKED_IN') throw new Reject('TICKET_CHECKED_IN', tid);
    }
    const [d, terms] = this.refundTerms(c.at);
    if (terms.refund_bps === 0) throw new Reject('REFUND_WINDOW_CLOSED', `days_before=${d}`);
    const rids: string[] = [];
    let total = 0;
    for (const tid of tids) {
      const t = this.tickets.get(tid)!;
      let amount = applyBps(t.price_cents, terms.refund_bps);
      if (terms.fee_refunded) amount += t.fee_cents;
      t.state = 'REFUNDED';
      t.refunded_cents = amount;
      t.refunded_at = c.at;
      if (t.seat) { const st = this.seats.get(t.seat)!; st.state = 'OPEN'; st.ticket_id = null; }
      rids.push(this.refund(oid, tid, amount, `CUSTOMER_${d}_DAYS`, c.at));
      total += amount;
    }
    this.fillWaitlist(c.at);
    return ['REFUNDED', `${rids.join(' ')} ${total} bps=${terms.refund_bps} days=${d}`];
  }

  // X-1..X-4
  private cmdCancel(c: Command): [string, string] {
    if (this.cancelledAt !== null) throw new Reject('ALREADY_CANCELLED', this.cancelledAt);
    const at = c.at;
    this.cancelledAt = at;
    let nT = 0;
    let total = 0;
    const b = this.ev.rules.cancellation_refund_bps;
    for (const tid of sortedStrings([...this.tickets.keys()])) {
      const t = this.tickets.get(tid)!;
      if (t.state === 'ISSUED' || t.state === 'CHECKED_IN') {
        const amount = applyBps(t.price_cents, b) + t.fee_cents;
        t.state = 'REFUNDED';
        t.refunded_cents = amount;
        t.refunded_at = at;
        if (t.seat) { const st = this.seats.get(t.seat)!; st.state = 'OPEN'; st.ticket_id = null; }
        this.refund(t.order_id, tid, amount, 'EVENT_CANCELLED', at);
        nT++;
        total += amount;
      }
    }
    for (const hid of sortedStrings([...this.holds.keys()])) {
      const h = this.holds.get(hid)!;
      if (h.state === 'HELD' || h.state === 'PAYING') this.setHoldState(h, 'CANCELLED', at);
    }
    for (const e of this.waitlist) if (e.state === 'WAITING' || e.state === 'OFFERED') { e.state = 'CLOSED'; e.ended_at = at; }
    return ['EVENT_CANCELLED_OK', `tickets=${nT} refunded_cents=${total}`];
  }

  // C-1..C-4
  private cmdCheckIn(c: Command): [string, string] {
    const tid = c.ref ?? '';
    const t = this.tickets.get(tid);
    if (!t) throw new Reject('TICKET_UNKNOWN', tid);
    if (t.state === 'REFUNDED') throw new Reject('TICKET_REFUNDED', tid);
    if (c.at < this.ev.doors_at) throw new Reject('DOORS_NOT_OPEN', this.ev.doors_at);
    if (t.state === 'CHECKED_IN') throw new Reject('ALREADY_CHECKED_IN', t.checked_in_at!);
    t.state = 'CHECKED_IN';
    t.checked_in_at = c.at;
    return ['CHECKED_IN', tid];
  }

  // ------------------------------------------------------------------ reports (§8)
  inventoryRows(): InventoryRow[] {
    const rows: InventoryRow[] = [];
    for (const [tid, t] of this.tiers) {
      let refunded = 0;
      for (const x of this.tickets.values()) if (x.tier === tid && x.state === 'REFUNDED') refunded++;
      rows.push({ scope: 'tier', id: tid, pool: t.pool_id, capacity: t.allotment, sold: this.tierSold(tid), held: this.tierHeld(tid), refunded, remaining: this.tierRemaining(tid), available: this.available(tid) });
    }
    for (const [pid, p] of this.pools) {
      let sold = 0, held = 0, refunded = 0;
      for (const [tid, t] of this.tiers) if (t.pool_id === pid) { sold += this.tierSold(tid); held += this.tierHeld(tid); }
      for (const x of this.tickets.values()) if (this.tiers.get(x.tier)!.pool_id === pid && x.state === 'REFUNDED') refunded++;
      rows.push({ scope: 'pool', id: pid, pool: pid, capacity: p.capacity, sold, held, refunded, remaining: this.poolRemaining(pid), available: this.poolRemaining(pid) });
    }
    return rows;
  }

  summary(): Summary {
    let captured = 0;
    for (const p of this.payments.values()) if (p.state.startsWith('SUCCEEDED')) captured += p.amount_cents;
    let refunded = 0;
    for (const r of this.refunds) refunded += r.amount_cents;
    const by_code: Record<string, number> = {};
    for (const r of this.results) by_code[r.code] = (by_code[r.code] ?? 0) + 1;
    const ws: Record<string, number> = {};
    for (const e of this.waitlist) ws[e.state] = (ws[e.state] ?? 0) + 1;
    const hs: Record<string, number> = {};
    for (const h of this.holds.values()) { const k = `${h.kind}_${h.state}`; hs[k] = (hs[k] ?? 0) + 1; }
    const ticketsLive = [...this.tickets.values()].sort((a, b) => compareStrings(a.ticket_id, b.ticket_id))
      .map((t) => ({ ticket_id: t.ticket_id, order_id: t.order_id, tier: t.tier, seat: t.seat, state: t.state, refunded_cents: t.refunded_cents, code: t.code }));
    const commitment = sha256Hex(canonicalJson({ event_id: this.ev.event_id, tickets: ticketsLive, captured_cents: captured, refunded_cents: refunded }));
    let live = 0, ref = 0, checked = 0;
    for (const t of this.tickets.values()) { if (t.state === 'ISSUED' || t.state === 'CHECKED_IN') live++; if (t.state === 'REFUNDED') ref++; if (t.state === 'CHECKED_IN') checked++; }
    return {
      commands: this.results.length,
      ok: this.results.filter((r) => r.status === 'OK').length,
      rejected: this.results.filter((r) => r.status === 'REJECT').length,
      by_code, orders: this.orders.size, tickets_issued: this.tickets.size, tickets_live: live, tickets_refunded: ref, checked_in: checked,
      captured_cents: captured, refunded_cents: refunded, net_cents: captured - refunded, refunds: this.refunds.length,
      holds: hs, waitlist: ws, offers_made: this.nOffer, commitment,
    };
  }
}
