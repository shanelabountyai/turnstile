"""Turnstile reference oracle — ticket inventory engine (stdlib only).

This is a TEST ORACLE, not product code. The TypeScript engine under
`src/inventory/` is written from `docs/domain-brief.md` §4–§9 and must agree
with this module on every command, every count and every commitment.

Design rules it embodies (see docs/decisions.md):
- Pure and deterministic: no clock, no randomness, no I/O. Commands are
  evaluated in (at, cmd_id) order whatever order they arrive in.
- Timestamps are fixed-width strings `YYYY-MM-DDTHH:MM:SS` on ONE named axis
  (`event.timezone_label`); arithmetic (TTLs, days-before) is done on that axis
  only. No zone conversion anywhere.
- Money is integer cents; proportions are basis points; division floors and the
  remainder stays with the venue.
- Every command receives exactly one code from a closed set with a stated
  precedence; rejected commands are recorded, never dropped.
- The pool is the truth. A tier's allotment is a ceiling; availability is
  min(tier remaining, pool remaining).
- The machine never picks a customer out of order: waitlists are FIFO by
  (joined_at, entry_id) and the head blocks (HEAD_BLOCKS).
"""

import hashlib
import json
from datetime import datetime, timedelta

TS = "%Y-%m-%dT%H:%M:%S"


def parse_ts(s):
    if len(s) != 19:
        raise ValueError("INPUT_INVALID: timestamp %r" % s)
    return datetime.strptime(s, TS)


def fmt_ts(d):
    return d.strftime(TS)


def add_minutes(s, minutes):
    return fmt_ts(parse_ts(s) + timedelta(minutes=minutes))


def days_before(later, earlier):
    """Whole days from `earlier` to `later` on the same axis (floored)."""
    secs = int((parse_ts(later) - parse_ts(earlier)).total_seconds())
    return secs // 86400


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_hex(s):
    return hashlib.sha256(s.encode("ascii")).hexdigest()


# ----------------------------------------------------------------------------
# Closed vocabularies
# ----------------------------------------------------------------------------

KINDS = [
    "HOLD", "RELEASE", "PAY_START", "PAY_SUCCEEDED", "PAY_FAILED",
    "WAITLIST_JOIN", "WAITLIST_LEAVE", "REFUND_REQUEST", "CANCEL_EVENT",
    "CHECK_IN",
]

# OK codes (the command was applied)
OK_CODES = [
    "HELD", "RELEASED", "PAYING", "CONFIRMED", "PAYMENT_FAILED_RELEASED",
    "PAID_AFTER_TIMEOUT", "PAID_AFTER_CANCEL", "PAYMENT_DUPLICATE",
    "WAITLISTED", "WAITLIST_LEFT", "REFUNDED", "EVENT_CANCELLED_OK",
    "CHECKED_IN",
]

# REJECT codes, in the order they are checked (brief §4)
REJECT_CODES = [
    "KIND_UNKNOWN",
    "EVENT_CANCELLED",
    "SALES_NOT_OPEN", "SALES_CLOSED",
    "TIER_UNKNOWN", "TIER_NOT_ON_SALE",
    "HOLD_ID_DUPLICATE",
    "QTY_INVALID", "QTY_OVER_LIMIT",
    "SEAT_UNKNOWN", "SEAT_DUPLICATE", "SEAT_TIER_MISMATCH", "SEATS_REQUIRED", "SEATS_NOT_ALLOWED",
    "SOLD_OUT_POOL", "SOLD_OUT_TIER", "SEAT_TAKEN", "ORPHAN_SEAT",
    "HOLD_UNKNOWN", "HOLD_NOT_YOURS", "HOLD_EXPIRED", "HOLD_RELEASED", "HOLD_NOT_HELD",
    "PAYMENT_ID_DUPLICATE", "PAYMENT_UNKNOWN",
    "WAITLIST_TARGET_UNKNOWN", "WAITLIST_NOT_NEEDED", "WAITLIST_DUPLICATE", "WAITLIST_UNKNOWN", "WAITLIST_NOT_YOURS",
    "ORDER_UNKNOWN", "ORDER_NOT_YOURS", "TICKET_NOT_IN_ORDER", "TICKET_ALREADY_REFUNDED", "TICKET_CHECKED_IN", "REFUND_WINDOW_CLOSED",
    "TICKET_UNKNOWN", "TICKET_REFUNDED", "DOORS_NOT_OPEN", "ALREADY_CHECKED_IN",
    "ALREADY_CANCELLED",
]

HOLD_STATES = ["HELD", "PAYING", "CONFIRMED", "RELEASED", "EXPIRED",
               "PAY_FAILED", "PAY_TIMEOUT", "CANCELLED"]


class Reject(Exception):
    def __init__(self, code, detail=""):
        super().__init__(code)
        self.code = code
        self.detail = detail


def validate_event(ev):
    """Closed-schema checks the engine refuses on (RULES_INVALID)."""
    r = ev["rules"]
    if r.get("waitlist_rule") != "HEAD_BLOCKS":
        raise ValueError("RULES_INVALID: waitlist_rule")
    if r.get("offer_expired_rule") != "DROP":
        raise ValueError("RULES_INVALID: offer_expired_rule")
    for k in ("hold_ttl_minutes", "offer_ttl_minutes", "payment_timeout_minutes",
              "max_tickets_per_order", "service_fee_cents", "cancellation_refund_bps"):
        if not isinstance(r.get(k), int) or r[k] < 0:
            raise ValueError("RULES_INVALID: %s" % k)
    if not isinstance(r.get("prevent_orphan_seats"), bool):
        raise ValueError("RULES_INVALID: prevent_orphan_seats")
    pol = r.get("refund_policy")
    if not pol or [p["min_days_before"] for p in pol] != sorted(
            [p["min_days_before"] for p in pol], reverse=True):
        raise ValueError("RULES_INVALID: refund_policy order")
    if pol[-1]["min_days_before"] != 0:
        raise ValueError("RULES_INVALID: refund_policy must end at 0 days")
    for p in pol:
        if not (0 <= p["refund_bps"] <= 10000):
            raise ValueError("RULES_INVALID: refund_bps")
    pools = {p["pool_id"]: p for p in ev["pools"]}
    for t in ev["tiers"]:
        if t["pool_id"] not in pools:
            raise ValueError("RULES_INVALID: tier pool")
        if t["price_cents"] < 0 or t["allotment"] < 0:
            raise ValueError("RULES_INVALID: tier numbers")
    for p in ev["pools"]:
        if p["kind"] not in ("GA", "RESERVED"):
            raise ValueError("RULES_INVALID: pool kind")
    # reserved pool capacity must equal its seat count
    seat_counts = {}
    for sec in ev.get("sections", []):
        seat_counts[sec["pool_id"]] = seat_counts.get(sec["pool_id"], 0) + len(sec["rows"]) * sec["seats_per_row"]
    for p in ev["pools"]:
        if p["kind"] == "RESERVED" and seat_counts.get(p["pool_id"], 0) != p["capacity"]:
            raise ValueError("RULES_INVALID: reserved capacity != seats")
    for s in ("starts_at", "doors_at", "sales_open_at", "sales_close_at"):
        parse_ts(ev[s])
    return True


class Engine:
    def __init__(self, event):
        validate_event(event)
        self.ev = event
        self.rules = event["rules"]
        self.pools = {p["pool_id"]: p for p in event["pools"]}
        self.tiers = {t["tier_id"]: t for t in event["tiers"]}
        self.sections = {s["section_id"]: s for s in event.get("sections", [])}
        # seats
        self.seats = {}            # seat_id -> dict
        self.rows = {}             # (section, row) -> [seat_id...] in seat order
        for sec in event.get("sections", []):
            tier = [t for t in event["tiers"] if t["pool_id"] == sec["pool_id"]]
            if len(tier) != 1:
                raise ValueError("RULES_INVALID: reserved pool needs exactly one tier")
            for row in sec["rows"]:
                ids = []
                for n in range(1, sec["seats_per_row"] + 1):
                    sid = "%s-%s-%02d" % (sec["section_id"], row, n)
                    self.seats[sid] = {"seat_id": sid, "section": sec["section_id"], "row": row,
                                       "num": n, "tier": tier[0]["tier_id"], "pool": sec["pool_id"],
                                       "state": "OPEN", "hold_id": None, "ticket_id": None}
                    ids.append(sid)
                self.rows[(sec["section_id"], row)] = ids
        self.holds = {}
        self.payments = {}
        self.orders = {}
        self.tickets = {}
        self.waitlist = []         # list of entry dicts
        self.refunds = []
        self.results = []
        self.cancelled_at = None
        self.n_order = 0
        self.n_ticket = 0
        self.n_entry = 0
        self.n_offer = 0
        self.n_refund = 0
        self.seen_cmd = set()
        self.now = None

    # ------------------------------------------------------------------ counts
    def tier_sold(self, tier_id):
        return sum(1 for t in self.tickets.values()
                   if t["tier"] == tier_id and t["state"] in ("ISSUED", "CHECKED_IN"))

    def tier_held(self, tier_id):
        return sum(h["qty"] for h in self.holds.values()
                   if h["tier"] == tier_id and h["state"] in ("HELD", "PAYING"))

    def pool_used(self, pool_id):
        return sum(self.tier_sold(t) + self.tier_held(t)
                   for t, tt in self.tiers.items() if tt["pool_id"] == pool_id)

    def pool_remaining(self, pool_id):
        return self.pools[pool_id]["capacity"] - self.pool_used(pool_id)

    def tier_remaining(self, tier_id):
        t = self.tiers[tier_id]
        return t["allotment"] - self.tier_sold(tier_id) - self.tier_held(tier_id)

    def available(self, tier_id):
        t = self.tiers[tier_id]
        return min(self.tier_remaining(tier_id), self.pool_remaining(t["pool_id"]))

    def tier_on_sale(self, tier_id, at):
        t = self.tiers[tier_id]
        return t["on_sale_at"] <= at < t["off_sale_at"]

    # ------------------------------------------------------------------ seats
    def orphans_in_row(self, key, occupied_extra=()):
        ids = self.rows[key]
        occ = [self.seats[s]["state"] != "OPEN" or s in occupied_extra for s in ids]
        n = 0
        for i, o in enumerate(occ):
            if o:
                continue
            left = occ[i - 1] if i > 0 else None
            right = occ[i + 1] if i + 1 < len(occ) else None
            if left is True and right is True:
                n += 1
        return n

    def creates_orphan(self, seat_ids):
        if not self.rules["prevent_orphan_seats"]:
            return False
        by_row = {}
        for s in seat_ids:
            st = self.seats[s]
            by_row.setdefault((st["section"], st["row"]), []).append(s)
        for key, ss in by_row.items():
            if self.orphans_in_row(key, occupied_extra=set(ss)) > self.orphans_in_row(key):
                return True
        return False

    def contiguous_block(self, section_id, qty):
        """Lowest row, lowest start of `qty` OPEN contiguous seats that creates no orphan."""
        sec = self.sections[section_id]
        for row in sec["rows"]:
            ids = self.rows[(section_id, row)]
            for start in range(0, len(ids) - qty + 1):
                block = ids[start:start + qty]
                if all(self.seats[s]["state"] == "OPEN" for s in block) and not self.creates_orphan(block):
                    return block
        return None

    def section_can_serve(self, section_id, qty):
        return self.contiguous_block(section_id, qty) is not None

    # ------------------------------------------------------------------ clock
    def advance(self, at):
        """Expire holds/offers and time out payments with expires_at <= at, then fill."""
        changed = False
        for h in sorted(self.holds.values(), key=lambda h: (h["expires_at"], h["hold_id"])):
            if h["state"] == "HELD" and h["expires_at"] <= at:
                self._set_hold_state(h, "EXPIRED", at)
                if h["kind"] == "OFFER":
                    e = self._entry(h["entry_id"])
                    e["state"] = "OFFER_EXPIRED"
                    e["ended_at"] = at
                changed = True
            elif h["state"] == "PAYING" and h["pay_timeout_at"] <= at:
                self._set_hold_state(h, "PAY_TIMEOUT", at)
                changed = True
        # a GA tier that has gone off sale offers nothing more: its waiting entries close (W-5)
        for e in self.waitlist:
            if e["state"] == "WAITING" and e["target"] in self.tiers and self.tiers[e["target"]]["off_sale_at"] <= at:
                e["state"] = "CLOSED_OFF_SALE"
                e["ended_at"] = self.tiers[e["target"]]["off_sale_at"]
        if changed:
            self.fill_waitlist(at)

    def _set_hold_state(self, h, state, at):
        h["state"] = state
        h["ended_at"] = at
        if state in ("EXPIRED", "RELEASED", "PAY_FAILED", "PAY_TIMEOUT", "CANCELLED"):
            for s in h["seats"]:
                st = self.seats[s]
                if st["hold_id"] == h["hold_id"] and st["state"] == "HELD":
                    st["state"] = "OPEN"
                    st["hold_id"] = None

    def _entry(self, entry_id):
        for e in self.waitlist:
            if e["entry_id"] == entry_id:
                return e
        raise KeyError(entry_id)

    def fill_waitlist(self, at):
        """HEAD_BLOCKS: for each target the head entry is offered when it fits; nobody is skipped."""
        if self.cancelled_at:
            return
        targets = sorted({e["target"] for e in self.waitlist if e["state"] == "WAITING"})
        for target in targets:
            while True:
                waiting = sorted([e for e in self.waitlist if e["target"] == target and e["state"] == "WAITING"],
                                 key=lambda e: (e["joined_at"], e["entry_id"]))
                if not waiting:
                    break
                head = waiting[0]
                if target in self.tiers:
                    if not self.tier_on_sale(target, at):
                        break   # an off-sale tier offers nothing; the entry waits (W-4)
                    if self.available(target) < head["qty"]:
                        break
                    seats = []
                    tier_id = target
                else:
                    block = self.contiguous_block(target, head["qty"])
                    if block is None:
                        break
                    seats = block
                    tier_id = self.seats[block[0]]["tier"]
                self.n_offer += 1
                hid = "O-%04d" % self.n_offer
                self._create_hold(hid, "OFFER", head["customer"], tier_id, head["qty"], seats, at,
                                  add_minutes(at, self.rules["offer_ttl_minutes"]), entry_id=head["entry_id"])
                head["state"] = "OFFERED"
                head["offer_id"] = hid
                head["offered_at"] = at
                # the head now holds inventory, so the next head is evaluated against what is left

    def _create_hold(self, hid, kind, customer, tier_id, qty, seats, at, expires_at, entry_id=None):
        t = self.tiers[tier_id]
        h = {"hold_id": hid, "kind": kind, "customer": customer, "tier": tier_id, "qty": qty,
             "seats": list(seats), "state": "HELD", "created_at": at, "expires_at": expires_at,
             "price_cents": t["price_cents"], "fee_cents": self.rules["service_fee_cents"],
             "payment_id": None, "pay_started_at": None, "pay_timeout_at": None,
             "entry_id": entry_id, "order_id": None, "ended_at": None}
        for s in seats:
            self.seats[s]["state"] = "HELD"
            self.seats[s]["hold_id"] = hid
        self.holds[hid] = h
        return h

    # ------------------------------------------------------------------ commands
    def run(self, commands):
        ordered = sorted(commands, key=lambda c: (c["at"], c["cmd_id"]))
        for c in ordered:
            self.apply(c)
        return self.results

    def apply(self, c):
        at = c["at"]
        parse_ts(at)
        if self.now is not None and at < self.now:
            raise ValueError("INPUT_INVALID: commands must be applied in time order")
        if c["cmd_id"] in self.seen_cmd:
            raise ValueError("INPUT_INVALID: duplicate cmd_id %s" % c["cmd_id"])
        self.seen_cmd.add(c["cmd_id"])
        self.now = at
        self.advance(at)
        try:
            code, detail = self._dispatch(c)
            status = "OK"
        except Reject as r:
            code, detail, status = r.code, r.detail, "REJECT"
        res = {"cmd_id": c["cmd_id"], "at": at, "kind": c["kind"], "customer": c.get("customer", ""),
               "status": status, "code": code, "detail": detail}
        self.results.append(res)
        return res

    def _dispatch(self, c):
        k = c["kind"]
        if k not in KINDS:
            raise Reject("KIND_UNKNOWN", k)
        if k == "CANCEL_EVENT":
            return self.cmd_cancel(c)
        if self.cancelled_at is not None:
            if k == "PAY_SUCCEEDED":
                return self.cmd_pay_succeeded(c)   # late webhooks after cancel are handled, not rejected
            raise Reject("EVENT_CANCELLED")
        return {
            "HOLD": self.cmd_hold, "RELEASE": self.cmd_release, "PAY_START": self.cmd_pay_start,
            "PAY_SUCCEEDED": self.cmd_pay_succeeded, "PAY_FAILED": self.cmd_pay_failed,
            "WAITLIST_JOIN": self.cmd_waitlist_join, "WAITLIST_LEAVE": self.cmd_waitlist_leave,
            "REFUND_REQUEST": self.cmd_refund, "CHECK_IN": self.cmd_check_in,
        }[k](c)

    def _sales_window(self, at):
        if at < self.ev["sales_open_at"]:
            raise Reject("SALES_NOT_OPEN")
        if at >= self.ev["sales_close_at"]:
            raise Reject("SALES_CLOSED")

    def cmd_hold(self, c):
        at = c["at"]
        self._sales_window(at)
        tier_id = c.get("tier_id", "")
        if tier_id not in self.tiers:
            raise Reject("TIER_UNKNOWN", tier_id)
        if not self.tier_on_sale(tier_id, at):
            raise Reject("TIER_NOT_ON_SALE", tier_id)
        hid = c["ref"]
        if hid in self.holds:
            raise Reject("HOLD_ID_DUPLICATE", hid)
        pool = self.pools[self.tiers[tier_id]["pool_id"]]
        seats = c.get("seats") or []
        qty = c.get("qty") or 0
        if pool["kind"] == "RESERVED":
            if not seats:
                raise Reject("SEATS_REQUIRED")
            qty = len(seats)
        else:
            if seats:
                raise Reject("SEATS_NOT_ALLOWED")
        if qty < 1:
            raise Reject("QTY_INVALID", str(qty))
        if qty > self.rules["max_tickets_per_order"]:
            raise Reject("QTY_OVER_LIMIT", str(qty))
        if pool["kind"] == "RESERVED":
            if len(set(seats)) != len(seats):
                raise Reject("SEAT_DUPLICATE")
            for s in seats:
                if s not in self.seats:
                    raise Reject("SEAT_UNKNOWN", s)
                if self.seats[s]["tier"] != tier_id:
                    raise Reject("SEAT_TIER_MISMATCH", s)
            taken = [s for s in seats if self.seats[s]["state"] != "OPEN"]
            if taken:
                raise Reject("SEAT_TAKEN", " ".join(sorted(taken)))
            if self.creates_orphan(seats):
                raise Reject("ORPHAN_SEAT")
        else:
            if self.pool_remaining(pool["pool_id"]) < qty:
                raise Reject("SOLD_OUT_POOL", "pool=%d tier=%d" % (
                    self.pool_remaining(pool["pool_id"]), self.tier_remaining(tier_id)))
            if self.tier_remaining(tier_id) < qty:
                raise Reject("SOLD_OUT_TIER", "tier=%d pool=%d" % (
                    self.tier_remaining(tier_id), self.pool_remaining(pool["pool_id"])))
        self._create_hold(hid, "HOLD", c["customer"], tier_id, qty, seats, at,
                          add_minutes(at, self.rules["hold_ttl_minutes"]))
        return "HELD", hid

    def _get_hold(self, c, must_be_yours=True):
        hid = c.get("ref", "")
        h = self.holds.get(hid)
        if h is None:
            raise Reject("HOLD_UNKNOWN", hid)
        if must_be_yours and h["customer"] != c["customer"]:
            raise Reject("HOLD_NOT_YOURS", hid)
        return h

    def cmd_release(self, c):
        h = self._get_hold(c)
        if h["state"] == "EXPIRED":
            raise Reject("HOLD_EXPIRED", h["hold_id"])
        if h["state"] == "RELEASED":
            raise Reject("HOLD_RELEASED", h["hold_id"])
        if h["state"] != "HELD":
            raise Reject("HOLD_NOT_HELD", h["state"])
        self._set_hold_state(h, "RELEASED", c["at"])
        if h["kind"] == "OFFER":
            e = self._entry(h["entry_id"])
            e["state"] = "OFFER_DECLINED"
            e["ended_at"] = c["at"]
        self.fill_waitlist(c["at"])
        return "RELEASED", h["hold_id"]

    def cmd_pay_start(self, c):
        h = self._get_hold(c)
        if h["state"] == "EXPIRED":
            raise Reject("HOLD_EXPIRED", h["hold_id"])
        if h["state"] == "RELEASED":
            raise Reject("HOLD_RELEASED", h["hold_id"])
        if h["state"] != "HELD":
            raise Reject("HOLD_NOT_HELD", h["state"])
        pid = c.get("payment_id", "")
        if pid in self.payments:
            raise Reject("PAYMENT_ID_DUPLICATE", pid)
        h["state"] = "PAYING"
        h["payment_id"] = pid
        h["pay_started_at"] = c["at"]
        h["pay_timeout_at"] = add_minutes(c["at"], self.rules["payment_timeout_minutes"])
        amount = h["qty"] * (h["price_cents"] + h["fee_cents"])
        self.payments[pid] = {"payment_id": pid, "hold_id": h["hold_id"], "amount_cents": amount,
                              "state": "PENDING", "started_at": c["at"], "ended_at": None}
        return "PAYING", "%s %d" % (pid, amount)

    def cmd_pay_succeeded(self, c):
        pid = c.get("payment_id", "")
        p = self.payments.get(pid)
        if p is None:
            raise Reject("PAYMENT_UNKNOWN", pid)
        if p["state"] != "PENDING":
            return "PAYMENT_DUPLICATE", pid
        h = self.holds[p["hold_id"]]
        p["ended_at"] = c["at"]
        if h["state"] == "PAY_TIMEOUT":
            p["state"] = "SUCCEEDED_LATE"
            rid = self._refund(None, None, p["amount_cents"], "PAID_AFTER_TIMEOUT", c["at"], payment_id=pid)
            return "PAID_AFTER_TIMEOUT", "%s %d" % (rid, p["amount_cents"])
        if h["state"] == "CANCELLED":
            p["state"] = "SUCCEEDED_LATE"
            rid = self._refund(None, None, p["amount_cents"], "PAID_AFTER_CANCEL", c["at"], payment_id=pid)
            return "PAID_AFTER_CANCEL", "%s %d" % (rid, p["amount_cents"])
        if h["state"] != "PAYING":
            raise Reject("HOLD_NOT_HELD", h["state"])
        p["state"] = "SUCCEEDED"
        self.n_order += 1
        oid = "ORD-%05d" % self.n_order
        tids = []
        for i in range(h["qty"]):
            self.n_ticket += 1
            tid = "T-%05d" % self.n_ticket
            seat = h["seats"][i] if h["seats"] else ""
            self.tickets[tid] = {"ticket_id": tid, "order_id": oid, "tier": h["tier"], "seat": seat,
                                 "price_cents": h["price_cents"], "fee_cents": h["fee_cents"],
                                 "state": "ISSUED", "issued_at": c["at"], "checked_in_at": None,
                                 "refunded_cents": 0,
                                 "code": sha256_hex("%s|%s|%s" % (self.ev["event_id"], tid, self.ev["ticket_salt"]))[:20]}
            if seat:
                self.seats[seat]["state"] = "SOLD"
                self.seats[seat]["hold_id"] = None
                self.seats[seat]["ticket_id"] = tid
            tids.append(tid)
        self.orders[oid] = {"order_id": oid, "customer": h["customer"], "tier": h["tier"], "qty": h["qty"],
                            "seats": list(h["seats"]), "gross_cents": h["qty"] * h["price_cents"],
                            "fees_cents": h["qty"] * h["fee_cents"], "payment_id": pid,
                            "confirmed_at": c["at"], "tickets": tids, "hold_id": h["hold_id"],
                            "via_offer": h["kind"] == "OFFER"}
        h["state"] = "CONFIRMED"
        h["order_id"] = oid
        h["ended_at"] = c["at"]
        if h["kind"] == "OFFER":
            e = self._entry(h["entry_id"])
            e["state"] = "FULFILLED"
            e["ended_at"] = c["at"]
            e["order_id"] = oid
        return "CONFIRMED", "%s %s" % (oid, " ".join(tids))

    def cmd_pay_failed(self, c):
        pid = c.get("payment_id", "")
        p = self.payments.get(pid)
        if p is None:
            raise Reject("PAYMENT_UNKNOWN", pid)
        if p["state"] != "PENDING":
            return "PAYMENT_DUPLICATE", pid
        h = self.holds[p["hold_id"]]
        p["state"] = "FAILED"
        p["ended_at"] = c["at"]
        if h["state"] == "PAYING":
            self._set_hold_state(h, "PAY_FAILED", c["at"])
            if h["kind"] == "OFFER":
                e = self._entry(h["entry_id"])
                e["state"] = "OFFER_PAY_FAILED"
                e["ended_at"] = c["at"]
            self.fill_waitlist(c["at"])
        return "PAYMENT_FAILED_RELEASED", h["hold_id"]

    def cmd_waitlist_join(self, c):
        at = c["at"]
        self._sales_window(at)
        target = c.get("target", "")
        qty = c.get("qty") or 0
        if target in self.tiers:
            if not self.tier_on_sale(target, at):
                raise Reject("TIER_NOT_ON_SALE", target)
            if self.pools[self.tiers[target]["pool_id"]]["kind"] != "GA":
                raise Reject("WAITLIST_TARGET_UNKNOWN", target)
        elif target not in self.sections:
            raise Reject("WAITLIST_TARGET_UNKNOWN", target)
        if qty < 1:
            raise Reject("QTY_INVALID", str(qty))
        if qty > self.rules["max_tickets_per_order"]:
            raise Reject("QTY_OVER_LIMIT", str(qty))
        if target in self.tiers:
            if self.available(target) >= qty:
                raise Reject("WAITLIST_NOT_NEEDED", "available=%d" % self.available(target))
        else:
            if self.section_can_serve(target, qty):
                raise Reject("WAITLIST_NOT_NEEDED", "block available")
        for e in self.waitlist:
            if e["customer"] == c["customer"] and e["target"] == target and e["state"] in ("WAITING", "OFFERED"):
                raise Reject("WAITLIST_DUPLICATE", e["entry_id"])
        self.n_entry += 1
        eid = "W-%04d" % self.n_entry
        self.waitlist.append({"entry_id": eid, "customer": c["customer"], "target": target, "qty": qty,
                              "joined_at": at, "state": "WAITING", "offer_id": None, "offered_at": None,
                              "ended_at": None, "order_id": None})
        return "WAITLISTED", eid

    def cmd_waitlist_leave(self, c):
        eid = c.get("ref", "")
        e = next((e for e in self.waitlist if e["entry_id"] == eid), None)
        if e is None:
            raise Reject("WAITLIST_UNKNOWN", eid)
        if e["customer"] != c["customer"]:
            raise Reject("WAITLIST_NOT_YOURS", eid)
        if e["state"] not in ("WAITING", "OFFERED"):
            raise Reject("WAITLIST_UNKNOWN", "%s %s" % (eid, e["state"]))
        if e["state"] == "OFFERED":
            h = self.holds[e["offer_id"]]
            if h["state"] == "HELD":
                self._set_hold_state(h, "RELEASED", c["at"])
            # an offer already PAYING cannot be left; it resolves by webhook
            elif h["state"] == "PAYING":
                raise Reject("HOLD_NOT_HELD", "PAYING")
        e["state"] = "LEFT"
        e["ended_at"] = c["at"]
        self.fill_waitlist(c["at"])
        return "WAITLIST_LEFT", eid

    def refund_terms(self, at):
        d = days_before(self.ev["starts_at"], at)
        for p in self.rules["refund_policy"]:
            if d >= p["min_days_before"]:
                return d, p
        return d, self.rules["refund_policy"][-1]

    def _refund(self, order_id, ticket_id, amount, reason, at, payment_id=None):
        self.n_refund += 1
        rid = "R-%05d" % self.n_refund
        self.refunds.append({"refund_id": rid, "order_id": order_id or "", "ticket_id": ticket_id or "",
                             "payment_id": payment_id or (self.orders[order_id]["payment_id"] if order_id else ""),
                             "amount_cents": amount, "reason": reason, "at": at})
        return rid

    def cmd_refund(self, c):
        oid = c.get("ref", "")
        o = self.orders.get(oid)
        if o is None:
            raise Reject("ORDER_UNKNOWN", oid)
        if o["customer"] != c["customer"]:
            raise Reject("ORDER_NOT_YOURS", oid)
        tids = c.get("tickets") or []
        if not tids:
            raise Reject("TICKET_NOT_IN_ORDER", "(none)")
        for tid in tids:
            if tid not in o["tickets"]:
                raise Reject("TICKET_NOT_IN_ORDER", tid)
        for tid in tids:
            t = self.tickets[tid]
            if t["state"] == "REFUNDED":
                raise Reject("TICKET_ALREADY_REFUNDED", tid)
            if t["state"] == "CHECKED_IN":
                raise Reject("TICKET_CHECKED_IN", tid)
        d, terms = self.refund_terms(c["at"])
        if terms["refund_bps"] == 0:
            raise Reject("REFUND_WINDOW_CLOSED", "days_before=%d" % d)
        rids = []
        total = 0
        for tid in tids:
            t = self.tickets[tid]
            amount = t["price_cents"] * terms["refund_bps"] // 10000
            if terms["fee_refunded"]:
                amount += t["fee_cents"]
            t["state"] = "REFUNDED"
            t["refunded_cents"] = amount
            t["refunded_at"] = c["at"]
            if t["seat"]:
                st = self.seats[t["seat"]]
                st["state"] = "OPEN"
                st["ticket_id"] = None
            rids.append(self._refund(oid, tid, amount, "CUSTOMER_%d_DAYS" % d, c["at"]))
            total += amount
        self.fill_waitlist(c["at"])
        return "REFUNDED", "%s %d bps=%d days=%d" % (" ".join(rids), total, terms["refund_bps"], d)

    def cmd_cancel(self, c):
        if self.cancelled_at is not None:
            raise Reject("ALREADY_CANCELLED", self.cancelled_at)
        at = c["at"]
        self.cancelled_at = at
        n_t = 0
        total = 0
        bps = self.rules["cancellation_refund_bps"]
        for tid in sorted(self.tickets):
            t = self.tickets[tid]
            if t["state"] in ("ISSUED", "CHECKED_IN"):
                amount = t["price_cents"] * bps // 10000 + t["fee_cents"]
                t["state"] = "REFUNDED"
                t["refunded_cents"] = amount
                t["refunded_at"] = at
                if t["seat"]:
                    self.seats[t["seat"]]["state"] = "OPEN"
                    self.seats[t["seat"]]["ticket_id"] = None
                self._refund(t["order_id"], tid, amount, "EVENT_CANCELLED", at)
                n_t += 1
                total += amount
        for hid in sorted(self.holds):
            h = self.holds[hid]
            if h["state"] in ("HELD", "PAYING"):
                self._set_hold_state(h, "CANCELLED", at)
        for e in self.waitlist:
            if e["state"] in ("WAITING", "OFFERED"):
                e["state"] = "CLOSED"
                e["ended_at"] = at
        return "EVENT_CANCELLED_OK", "tickets=%d refunded_cents=%d" % (n_t, total)

    def cmd_check_in(self, c):
        tid = c.get("ref", "")
        t = self.tickets.get(tid)
        if t is None:
            raise Reject("TICKET_UNKNOWN", tid)
        if t["state"] == "REFUNDED":
            raise Reject("TICKET_REFUNDED", tid)
        if c["at"] < self.ev["doors_at"]:
            raise Reject("DOORS_NOT_OPEN", self.ev["doors_at"])
        if t["state"] == "CHECKED_IN":
            raise Reject("ALREADY_CHECKED_IN", t["checked_in_at"])
        t["state"] = "CHECKED_IN"
        t["checked_in_at"] = c["at"]
        return "CHECKED_IN", tid

    # ------------------------------------------------------------------ reports
    def inventory_rows(self):
        rows = []
        for tid, t in self.tiers.items():
            sold = self.tier_sold(tid)
            held = self.tier_held(tid)
            refunded = sum(1 for x in self.tickets.values() if x["tier"] == tid and x["state"] == "REFUNDED")
            rows.append({"scope": "tier", "id": tid, "pool": t["pool_id"], "capacity": t["allotment"],
                         "sold": sold, "held": held, "refunded": refunded,
                         "remaining": self.tier_remaining(tid), "available": self.available(tid)})
        for pid, p in self.pools.items():
            sold = sum(self.tier_sold(t) for t, tt in self.tiers.items() if tt["pool_id"] == pid)
            held = sum(self.tier_held(t) for t, tt in self.tiers.items() if tt["pool_id"] == pid)
            refunded = sum(1 for x in self.tickets.values()
                           if self.tiers[x["tier"]]["pool_id"] == pid and x["state"] == "REFUNDED")
            rows.append({"scope": "pool", "id": pid, "pool": pid, "capacity": p["capacity"], "sold": sold,
                         "held": held, "refunded": refunded, "remaining": self.pool_remaining(pid),
                         "available": self.pool_remaining(pid)})
        return rows

    def summary(self):
        captured = sum(p["amount_cents"] for p in self.payments.values() if p["state"].startswith("SUCCEEDED"))
        refunded = sum(r["amount_cents"] for r in self.refunds)
        by_code = {}
        for r in self.results:
            by_code[r["code"]] = by_code.get(r["code"], 0) + 1
        ws = {}
        for e in self.waitlist:
            ws[e["state"]] = ws.get(e["state"], 0) + 1
        hs = {}
        for h in self.holds.values():
            key = ("OFFER_" if h["kind"] == "OFFER" else "HOLD_") + h["state"]
            hs[key] = hs.get(key, 0) + 1
        tickets_live = sorted(
            [{"ticket_id": t["ticket_id"], "order_id": t["order_id"], "tier": t["tier"], "seat": t["seat"],
              "state": t["state"], "refunded_cents": t["refunded_cents"], "code": t["code"]}
             for t in self.tickets.values()], key=lambda x: x["ticket_id"])
        commitment = sha256_hex(canonical({"event_id": self.ev["event_id"], "tickets": tickets_live,
                                           "captured_cents": captured, "refunded_cents": refunded}))
        return {
            "commands": len(self.results),
            "ok": sum(1 for r in self.results if r["status"] == "OK"),
            "rejected": sum(1 for r in self.results if r["status"] == "REJECT"),
            "by_code": by_code,
            "orders": len(self.orders),
            "tickets_issued": len(self.tickets),
            "tickets_live": sum(1 for t in self.tickets.values() if t["state"] in ("ISSUED", "CHECKED_IN")),
            "tickets_refunded": sum(1 for t in self.tickets.values() if t["state"] == "REFUNDED"),
            "checked_in": sum(1 for t in self.tickets.values() if t["state"] == "CHECKED_IN"),
            "captured_cents": captured,
            "refunded_cents": refunded,
            "net_cents": captured - refunded,
            "refunds": len(self.refunds),
            "holds": hs,
            "waitlist": ws,
            "offers_made": self.n_offer,
            "commitment": commitment,
        }
