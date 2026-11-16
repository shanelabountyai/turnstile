#!/usr/bin/env python3
"""Build the frozen Turnstile fixtures from a seed (stdlib only).

Writes fixtures/event.json, fixtures/customers.csv, fixtures/commands.csv and
fixtures/answer_key.csv. The command stream is produced by an event-queue
simulation driven against the oracle in inventorylib.py, so every id a later
command references (hold, offer, order, ticket) is the id the engine assigns.

Usage: python3 -I tools/build_fixtures.py --seed 20261109 [--out fixtures]

Nothing here is product code; `src/` never reads answer_key.csv.
"""

import argparse
import csv
import hashlib
import heapq
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventorylib as lib  # noqa: E402

EVENT = {
    "event_id": "EV-SYNTH-001",
    "name": "Synthetic Night (fixture)",
    "venue": "The Foundry Hall (invented)",
    "timezone_label": "America/Chicago",
    "starts_at": "2027-03-20T20:00:00",
    "doors_at": "2027-03-20T19:00:00",
    "sales_open_at": "2026-12-01T10:00:00",
    "sales_close_at": "2027-03-20T20:00:00",
    "currency": "USD",
    "ticket_salt": "fixture-salt-20261109",
    "pools": [
        {"pool_id": "FLOOR", "kind": "GA", "capacity": 800},
        {"pool_id": "BALCONY", "kind": "RESERVED", "capacity": 216},
    ],
    "tiers": [
        {"tier_id": "EARLY", "pool_id": "FLOOR", "allotment": 200, "price_cents": 2500,
         "on_sale_at": "2026-12-01T10:00:00", "off_sale_at": "2027-01-16T00:00:00"},
        {"tier_id": "ADV", "pool_id": "FLOOR", "allotment": 400, "price_cents": 3499,
         "on_sale_at": "2026-12-01T10:00:00", "off_sale_at": "2027-03-20T17:00:00"},
        {"tier_id": "DOOR", "pool_id": "FLOOR", "allotment": 300, "price_cents": 4500,
         "on_sale_at": "2027-03-20T17:00:00", "off_sale_at": "2027-03-20T20:00:00"},
        {"tier_id": "BALC", "pool_id": "BALCONY", "allotment": 216, "price_cents": 6000,
         "on_sale_at": "2026-12-01T10:00:00", "off_sale_at": "2027-03-20T20:00:00"},
    ],
    "sections": [
        {"section_id": "A", "pool_id": "BALCONY", "rows": ["A", "B", "C", "D", "E", "F"], "seats_per_row": 12},
        {"section_id": "B", "pool_id": "BALCONY", "rows": ["A", "B", "C", "D", "E", "F"], "seats_per_row": 12},
        {"section_id": "C", "pool_id": "BALCONY", "rows": ["A", "B", "C", "D", "E", "F"], "seats_per_row": 12},
    ],
    "rules": {
        "hold_ttl_minutes": 10,
        "offer_ttl_minutes": 1440,
        "payment_timeout_minutes": 30,
        "max_tickets_per_order": 8,
        "prevent_orphan_seats": True,
        "waitlist_rule": "HEAD_BLOCKS",
        "offer_expired_rule": "DROP",
        "service_fee_cents": 350,
        "refund_policy": [
            {"min_days_before": 30, "refund_bps": 10000, "fee_refunded": True},
            {"min_days_before": 7, "refund_bps": 5000, "fee_refunded": False},
            {"min_days_before": 0, "refund_bps": 0, "fee_refunded": False},
        ],
        "cancellation_refund_bps": 10000,
    },
}

FIRST = ["Ada", "Bram", "Cleo", "Dev", "Esme", "Farid", "Gwen", "Hiro", "Ines", "Jonah", "Kaia", "Lior",
         "Mara", "Nico", "Orla", "Pavel", "Quinn", "Rosa", "Sami", "Tova", "Umar", "Vera", "Wes", "Xiu",
         "Yara", "Zed"]
LAST = ["Abernathy", "Bellweather", "Castellan", "Dunmore", "Ellery", "Fairweather", "Greaves", "Holloway",
        "Ironside", "Jessop", "Kinsale", "Lockridge", "Marchetti", "Northcote", "Oakhurst", "Pemberton",
        "Quayle", "Rutherford", "Sandoval", "Thorne", "Underhill", "Vanterpool", "Whitlock", "Yeoman"]


def minutes(s, m):
    return lib.add_minutes(s, m)


def seconds(s, sec):
    return lib.fmt_ts(lib.parse_ts(s) + lib.timedelta(seconds=sec))


class Sim:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.engine = lib.Engine(EVENT)
        self.heap = []
        self.seq = 0
        self.commands = []
        self.answer_key = []     # (cmd_id, expected_code, trap)
        self.n_cmd = 0
        self.n_hold = 0
        self.n_pay = 0
        self.customers = []
        self.handled_offers = set()
        self.now = "2026-01-01T00:00:00"
        self.clamped = 0
        for i in range(1, 701):
            r = self.rng
            self.customers.append({"customer_id": "C-%04d" % i,
                                   "name": "%s %s" % (r.choice(FIRST), r.choice(LAST)),
                                   "email": "c%04d@example.com" % i})

    # ------------------------------------------------------------ plumbing
    def push(self, at, fn, *args):
        self.seq += 1
        heapq.heappush(self.heap, (at, self.seq, fn, args))

    def new_hold_id(self):
        self.n_hold += 1
        return "H-%05d" % self.n_hold

    def new_pay_id(self):
        self.n_pay += 1
        return "pi_fixture_%05d" % self.n_pay

    def emit(self, at, kind, customer="", trap=None, expect=None, **f):
        if at < self.now:
            # a background session landed inside a multi-step trap: it waits for the trap's last second
            at = self.now
            self.clamped += 1
        self.now = at
        self.n_cmd += 1
        cmd = {"cmd_id": "K-%05d" % self.n_cmd, "at": at, "kind": kind, "customer": customer,
               "ref": f.get("ref", ""), "tier_id": f.get("tier_id", ""), "qty": f.get("qty", 0),
               "seats": list(f.get("seats", [])), "payment_id": f.get("payment_id", ""),
               "target": f.get("target", ""), "tickets": list(f.get("tickets", [])),
               "note": f.get("note", "")}
        res = self.engine.apply(cmd)
        self.commands.append(cmd)
        if expect is not None:
            if res["code"] != expect:
                raise RuntimeError("trap %s at %s expected %s got %s (%s)" % (
                    trap, cmd["cmd_id"], expect, res["code"], res["detail"]))
            self.answer_key.append((cmd["cmd_id"], expect, trap))
        self.after_apply(at)
        return cmd, res

    TRAP_CUSTOMERS = 22   # C-0001..C-0022 are reserved for the named traps

    def rand_customer(self):
        return self.rng.choice(self.customers[self.TRAP_CUSTOMERS:])["customer_id"]

    def is_trap_customer(self, cid):
        return int(cid[2:]) <= self.TRAP_CUSTOMERS

    def rand_time(self, start, end):
        a, b = lib.parse_ts(start), lib.parse_ts(end)
        secs = int((b - a).total_seconds())
        return lib.fmt_ts(a + lib.timedelta(seconds=self.rng.randrange(secs)))

    # ------------------------------------------------------------ reactions
    def after_apply(self, at):
        # schedule a reaction for every new offer
        for e in self.engine.waitlist:
            if e["state"] == "OFFERED" and e["offer_id"] not in self.handled_offers:
                self.handled_offers.add(e["offer_id"])
                if self.is_trap_customer(e["customer"]):
                    continue   # trap customers react in their trap, not at random
                roll = self.rng.random()
                if roll < 0.70:
                    t = minutes(at, self.rng.randrange(10, 1200))
                    self.push(t, self.do_pay_start, e["customer"], e["offer_id"], 0.96)
                elif roll < 0.85:
                    t = minutes(at, self.rng.randrange(10, 600))
                    self.push(t, self.do_release, e["customer"], e["offer_id"])
                # else: ignored → the offer expires

    # ------------------------------------------------------------ actions
    def do_hold_ga(self, at, customer, tier_id, qty, waitlist_p=0.5):
        hid = self.new_hold_id()
        cmd, res = self.emit(at, "HOLD", customer, ref=hid, tier_id=tier_id, qty=qty)
        if res["status"] == "OK":
            self.schedule_outcome(at, customer, hid)
        elif res["code"] in ("SOLD_OUT_POOL", "SOLD_OUT_TIER") and self.rng.random() < waitlist_p:
            self.push(minutes(at, 1), self.do_waitlist_join, customer, tier_id, qty)
        return res

    def do_hold_seats(self, at, customer, qty, waitlist_p=0.6):
        eng = self.engine
        section = self.rng.choice(["A", "B", "C"])
        sec = eng.sections[section]
        rows = list(sec["rows"])
        self.rng.shuffle(rows)
        block = None
        for row in rows:
            ids = eng.rows[(section, row)]
            starts = list(range(0, len(ids) - qty + 1))
            self.rng.shuffle(starts)
            for s in starts:
                b = ids[s:s + qty]
                if all(eng.seats[x]["state"] == "OPEN" for x in b) and not eng.creates_orphan(b):
                    block = b
                    break
            if block:
                break
        if block is None:
            block = eng.contiguous_block(section, qty)
        if block is None:
            # nothing fits in this section: join its waitlist (section C's queue is reserved for trap T51–T61)
            if section != "C" and self.rng.random() < waitlist_p:
                self.push(minutes(at, 1), self.do_waitlist_join, customer, section, qty)
            return None
        hid = self.new_hold_id()
        cmd, res = self.emit(at, "HOLD", customer, ref=hid, tier_id="BALC", seats=block)
        if res["status"] == "OK":
            self.schedule_outcome(at, customer, hid)
        return res

    def schedule_outcome(self, at, customer, hid, pay_p=0.80, release_p=0.08):
        roll = self.rng.random()
        if roll < pay_p:
            self.push(minutes(at, self.rng.randrange(1, 9)), self.do_pay_start, customer, hid, 0.93)
        elif roll < pay_p + release_p:
            self.push(minutes(at, self.rng.randrange(1, 10)), self.do_release, customer, hid)
        # else abandoned → expires

    def do_pay_start(self, at, customer, hid, success_p):
        pid = self.new_pay_id()
        cmd, res = self.emit(at, "PAY_START", customer, ref=hid, payment_id=pid)
        if res["status"] == "OK":
            t = seconds(at, self.rng.randrange(5, 90))
            if self.rng.random() < success_p:
                self.push(t, self.do_pay_succeeded, pid)
            else:
                self.push(t, self.do_pay_failed, pid)
        return res

    def do_pay_succeeded(self, at, pid):
        return self.emit(at, "PAY_SUCCEEDED", "", payment_id=pid, note="webhook payment_intent.succeeded")

    def do_pay_failed(self, at, pid):
        return self.emit(at, "PAY_FAILED", "", payment_id=pid, note="webhook payment_intent.payment_failed")

    def do_release(self, at, customer, hid):
        return self.emit(at, "RELEASE", customer, ref=hid)

    def do_waitlist_join(self, at, customer, target, qty):
        return self.emit(at, "WAITLIST_JOIN", customer, target=target, qty=qty)

    def do_refund_random(self, at, tier=None, all_tickets=True):
        """Refund a random live order confirmed before `at` (customer's own)."""
        eng = self.engine
        cands = [o for o in eng.orders.values()
                 if o["confirmed_at"] < at and (tier is None or o["tier"] == tier)
                 and not self.is_trap_customer(o["customer"])
                 and all(eng.tickets[t]["state"] == "ISSUED" for t in o["tickets"])]
        if not cands:
            return None
        o = self.rng.choice(sorted(cands, key=lambda o: o["order_id"]))
        tix = list(o["tickets"]) if all_tickets or len(o["tickets"]) == 1 else [o["tickets"][0]]
        return self.emit(at, "REFUND_REQUEST", o["customer"], ref=o["order_id"], tickets=tix)

    def do_check_in(self, at, tid):
        return self.emit(at, "CHECK_IN", "", ref=tid)

    # ------------------------------------------------------------ scenario
    def seed_demand(self):
        r = self.rng
        # EARLY: ~105 sessions, qty 1-4 → ~240 tickets of demand for 200
        for _ in range(150):
            t = self.rand_time("2026-12-01T10:00:00", "2027-01-15T22:00:00")
            self.push(t, self.do_hold_ga, self.rand_customer(), "EARLY", r.choice([1, 1, 2, 2, 2, 3, 4]))
        # ADV: ~205 sessions Dec–Mar 19 → ~470 tickets of demand for 400
        for _ in range(290):
            t = self.rand_time("2026-12-01T10:30:00", "2027-03-19T22:00:00")
            self.push(t, self.do_hold_ga, self.rand_customer(), "ADV", r.choice([1, 2, 2, 2, 3, 3, 4]))
        # BALC: ~120 sessions Dec–Mar → ~270 seats of demand for 216
        for _ in range(190):
            t = self.rand_time("2026-12-01T11:00:00", "2027-03-18T22:00:00")
            self.push(t, self.do_hold_seats, self.rand_customer(), r.choice([1, 2, 2, 2, 3, 4, 4]))
        # DOOR: ~110 sessions on event day 17:00–19:45 → ~250 tickets of demand; pool decides
        for _ in range(110):
            t = self.rand_time("2027-03-20T17:00:00", "2027-03-20T19:20:00")
            self.push(t, self.do_hold_ga, self.rand_customer(), "DOOR", r.choice([1, 2, 2, 3, 4]), 0.0)  # DOOR waitlist is trap T68's
        # Refunds: full window (>=30 days before = up to 2027-02-18), half window (7..29 days), closed (<7)
        for _ in range(14):
            self.push(self.rand_time("2026-12-20T09:00:00", "2027-02-18T19:00:00"), self.do_refund_random, None, False)
        for _ in range(12):
            self.push(self.rand_time("2027-02-19T09:00:00", "2027-03-13T19:00:00"), self.do_refund_random, None, True)
        for _ in range(6):
            self.push(self.rand_time("2027-03-14T09:00:00", "2027-03-19T22:00:00"), self.do_refund_random, None, True)
        # Check-ins from doors
        self.push("2027-03-20T19:00:00", self.schedule_check_ins)

    def schedule_check_ins(self, at):
        live = sorted(t for t, x in self.engine.tickets.items() if x["state"] == "ISSUED")
        for tid in live:
            if self.rng.random() < 0.85:
                self.push(self.rand_time("2027-03-20T19:00:00", "2027-03-20T20:30:00"), self.do_check_in, tid)

    def seed_traps(self):
        """Named traps with exact timing. Each asserts the oracle's answer and lands in answer_key.csv."""
        self.push("2026-11-30T09:00:00", self.trap_sales_not_open)
        self.push("2026-12-01T10:00:00", self.trap_opening_second)
        self.push("2026-12-02T12:00:00", self.trap_seat_shapes)
        self.push("2026-12-03T12:00:00", self.trap_qty_and_duplicates)
        self.push("2026-12-05T15:00:00", self.trap_orphan_and_taken)
        self.push("2026-12-10T10:00:00", self.trap_pay_timeout)
        self.push("2026-12-12T10:00:00", self.trap_release_expired_and_not_yours)
        self.push("2027-01-04T12:00:00", self.trap_refund_full)
        self.push("2027-01-20T12:00:00", self.trap_waitlist_not_needed)
        self.push("2027-03-01T12:00:00", self.trap_refund_half)
        self.push("2027-03-12T10:00:00", self.trap_head_blocks)
        self.push("2027-03-15T12:00:00", self.trap_refund_closed_and_double)
        self.push("2027-03-19T12:00:00", self.trap_door_not_on_sale)
        self.push("2027-03-20T18:30:00", self.trap_checkin_before_doors)
        self.push("2027-03-20T19:32:00", self.trap_pool_boundary)
        self.push("2027-03-20T20:10:00", self.trap_checkin_dupes)
        self.push("2027-03-20T20:40:00", self.trap_after_close)

    # --- individual traps ---------------------------------------------------
    def trap_sales_not_open(self, at):
        self.emit(at, "HOLD", "C-0001", ref=self.new_hold_id(), tier_id="EARLY", qty=2,
                  trap="T01 sales not open", expect="SALES_NOT_OPEN")

    def trap_opening_second(self, at):
        # the first second of sales is inside the window
        hid = self.new_hold_id()
        self.emit(at, "HOLD", "C-0002", ref=hid, tier_id="EARLY", qty=2, trap="T02 opening second is on sale", expect="HELD")
        self.emit(at, "HOLD", "C-0003", ref=hid, tier_id="EARLY", qty=1, trap="T03 duplicate hold id", expect="HOLD_ID_DUPLICATE")
        self.emit(minutes(at, 2), "PAY_START", "C-0004", ref=hid, payment_id=self.new_pay_id(),
                  trap="T04 pay on someone else's hold", expect="HOLD_NOT_YOURS")
        pid = self.new_pay_id()
        self.emit(minutes(at, 3), "PAY_START", "C-0002", ref=hid, payment_id=pid, trap="T05 pay start", expect="PAYING")
        self.emit(minutes(at, 4), "PAY_SUCCEEDED", payment_id=pid, trap="T06 first webhook confirms", expect="CONFIRMED")
        self.emit(minutes(at, 5), "PAY_SUCCEEDED", payment_id=pid, trap="T07 replayed webhook is a no-op", expect="PAYMENT_DUPLICATE")
        self.emit(minutes(at, 6), "PAY_SUCCEEDED", payment_id="pi_fixture_unknown", trap="T08 unknown payment", expect="PAYMENT_UNKNOWN")

    def trap_seat_shapes(self, at):
        self.emit(at, "HOLD", "C-0005", ref=self.new_hold_id(), tier_id="EARLY", qty=2, seats=["A-A-01", "A-A-02"],
                  trap="T09 seats on a GA tier", expect="SEATS_NOT_ALLOWED")
        self.emit(minutes(at, 1), "HOLD", "C-0005", ref=self.new_hold_id(), tier_id="BALC", qty=2,
                  trap="T10 reserved tier without seats", expect="SEATS_REQUIRED")
        self.emit(minutes(at, 2), "HOLD", "C-0005", ref=self.new_hold_id(), tier_id="BALC", seats=["A-Z-99"],
                  trap="T11 unknown seat", expect="SEAT_UNKNOWN")
        self.emit(minutes(at, 3), "HOLD", "C-0005", ref=self.new_hold_id(), tier_id="BALC", seats=["B-C-05", "B-C-05"],
                  trap="T12 same seat twice", expect="SEAT_DUPLICATE")
        self.emit(minutes(at, 4), "HOLD", "C-0005", ref=self.new_hold_id(), tier_id="NOPE", qty=1,
                  trap="T13 unknown tier", expect="TIER_UNKNOWN")

    def trap_qty_and_duplicates(self, at):
        self.emit(at, "HOLD", "C-0006", ref=self.new_hold_id(), tier_id="ADV", qty=9,
                  trap="T14 over the per-order limit", expect="QTY_OVER_LIMIT")
        self.emit(minutes(at, 1), "HOLD", "C-0006", ref=self.new_hold_id(), tier_id="ADV", qty=0,
                  trap="T15 zero quantity", expect="QTY_INVALID")
        hid = self.new_hold_id()
        self.emit(minutes(at, 2), "HOLD", "C-0006", ref=hid, tier_id="ADV", qty=8, trap="T16 exactly the limit", expect="HELD")
        self.emit(minutes(at, 3), "RELEASE", "C-0006", ref=hid, trap="T17 release", expect="RELEASED")
        self.emit(minutes(at, 4), "RELEASE", "C-0006", ref=hid, trap="T18 release twice", expect="HOLD_RELEASED")
        self.emit(minutes(at, 5), "PAY_START", "C-0006", ref=hid, payment_id=self.new_pay_id(),
                  trap="T19 pay a released hold", expect="HOLD_RELEASED")

    def trap_orphan_and_taken(self, at):
        # Row C-F is untouched at this point in the fixture (asserted): take 01-02, then try 04-05 (leaves 03 orphan)
        eng = self.engine
        assert all(eng.seats[s]["state"] == "OPEN" for s in eng.rows[("C", "F")])
        h1 = self.new_hold_id()
        self.emit(at, "HOLD", "C-0007", ref=h1, tier_id="BALC", seats=["C-F-01", "C-F-02"], trap="T20 pair at the aisle", expect="HELD")
        self.emit(minutes(at, 1), "HOLD", "C-0008", ref=self.new_hold_id(), tier_id="BALC", seats=["C-F-04", "C-F-05"],
                  trap="T21 would orphan C-F-03", expect="ORPHAN_SEAT")
        h2 = self.new_hold_id()
        self.emit(minutes(at, 2), "HOLD", "C-0008", ref=h2, tier_id="BALC", seats=["C-F-03", "C-F-04"],
                  trap="T22 adjacent pair is fine", expect="HELD")
        self.emit(minutes(at, 3), "HOLD", "C-0009", ref=self.new_hold_id(), tier_id="BALC", seats=["C-F-04", "C-F-05"],
                  trap="T23 seat already held", expect="SEAT_TAKEN")
        # C-0007 pays; C-0008 abandons (expires at +12:00)
        pid = self.new_pay_id()
        self.emit(minutes(at, 4), "PAY_START", "C-0007", ref=h1, payment_id=pid, trap="T24 pay the pair", expect="PAYING")
        self.emit(seconds(minutes(at, 4), 30), "PAY_SUCCEEDED", payment_id=pid, trap="T25 pair confirmed", expect="CONFIRMED")
        # At exactly h2's expiry the seats are free again: boundary is inclusive (expires_at <= at)
        exp = minutes(at, 12)
        self.emit(seconds(exp, -1), "HOLD", "C-0009", ref=self.new_hold_id(), tier_id="BALC", seats=["C-F-03", "C-F-04"],
                  trap="T26 one second before expiry: still taken", expect="SEAT_TAKEN")
        h3 = self.new_hold_id()
        self.emit(exp, "HOLD", "C-0009", ref=h3, tier_id="BALC", seats=["C-F-03", "C-F-04"],
                  trap="T27 at the expiry second: free", expect="HELD")
        self.emit(minutes(exp, 1), "PAY_START", "C-0008", ref=h2, payment_id=self.new_pay_id(),
                  trap="T28 paying an expired hold", expect="HOLD_EXPIRED")
        pid3 = self.new_pay_id()
        self.emit(minutes(exp, 2), "PAY_START", "C-0009", ref=h3, payment_id=pid3, trap="T29 pay", expect="PAYING")
        self.emit(seconds(minutes(exp, 2), 20), "PAY_SUCCEEDED", payment_id=pid3, trap="T30 confirmed", expect="CONFIRMED")
        self.trap_orders = {"C-0007": eng.holds[h1]["order_id"], "C-0009": eng.holds[h3]["order_id"]}

    def trap_pay_timeout(self, at):
        hid = self.new_hold_id()
        self.emit(at, "HOLD", "C-0010", ref=hid, tier_id="ADV", qty=2, trap="T31 hold", expect="HELD")
        pid = self.new_pay_id()
        self.emit(minutes(at, 1), "PAY_START", "C-0010", ref=hid, payment_id=pid, trap="T32 pay start", expect="PAYING")
        # 31 minutes later the webhook lands: the hold timed out at +31:00, inventory went back, money comes back
        self.emit(minutes(at, 32), "PAY_SUCCEEDED", payment_id=pid, trap="T33 paid after timeout → refund, no tickets",
                  expect="PAID_AFTER_TIMEOUT")
        hid2 = self.new_hold_id()
        self.emit(minutes(at, 33), "HOLD", "C-0011", ref=hid2, tier_id="ADV", qty=1, trap="T34 hold", expect="HELD")
        pid2 = self.new_pay_id()
        self.emit(minutes(at, 34), "PAY_START", "C-0011", ref=hid2, payment_id=pid2, trap="T35 pay start", expect="PAYING")
        self.emit(minutes(at, 35), "PAY_FAILED", payment_id=pid2, trap="T36 payment failed releases the hold",
                  expect="PAYMENT_FAILED_RELEASED")
        self.emit(minutes(at, 36), "PAY_START", "C-0011", ref=hid2, payment_id=self.new_pay_id(),
                  trap="T37 cannot pay a failed hold again", expect="HOLD_NOT_HELD")

    def trap_release_expired_and_not_yours(self, at):
        hid = self.new_hold_id()
        self.emit(at, "HOLD", "C-0012", ref=hid, tier_id="EARLY", qty=1, trap="T38 hold", expect="HELD")
        self.emit(minutes(at, 11), "RELEASE", "C-0012", ref=hid, trap="T39 release after expiry", expect="HOLD_EXPIRED")
        self.emit(minutes(at, 12), "RELEASE", "C-0013", ref="H-99999", trap="T40 unknown hold", expect="HOLD_UNKNOWN")

    def trap_refund_full(self, at):
        # 2027-01-04 is 75 days before: 100% + fee. Refund one of C-0007's two balcony seats (C-F-01), 6000+350.
        oid = self.trap_orders["C-0007"]
        o = self.engine.orders[oid]
        t1 = o["tickets"][0]
        self.emit(at, "REFUND_REQUEST", "C-0007", ref=oid, tickets=[t1], trap="T41 full refund incl. fee (75 days)", expect="REFUNDED")
        r = self.engine.refunds[-1]
        assert r["amount_cents"] == 6350, r
        self.emit(minutes(at, 1), "REFUND_REQUEST", "C-0007", ref=oid, tickets=[t1], trap="T42 refund the same ticket twice",
                  expect="TICKET_ALREADY_REFUNDED")
        self.emit(minutes(at, 2), "REFUND_REQUEST", "C-0008", ref=oid, tickets=[o["tickets"][1]],
                  trap="T43 refund someone else's order", expect="ORDER_NOT_YOURS")
        self.emit(minutes(at, 3), "REFUND_REQUEST", "C-0007", ref=oid, tickets=["T-99999"],
                  trap="T44 ticket not in order", expect="TICKET_NOT_IN_ORDER")
        self.emit(minutes(at, 4), "REFUND_REQUEST", "C-0007", ref="ORD-99999", tickets=[t1],
                  trap="T45 unknown order", expect="ORDER_UNKNOWN")

    def trap_waitlist_not_needed(self, at):
        self.emit(at, "WAITLIST_JOIN", "C-0014", target="ADV", qty=2, trap="T46 waitlist while tickets are available",
                  expect="WAITLIST_NOT_NEEDED")
        self.emit(minutes(at, 1), "WAITLIST_JOIN", "C-0014", target="EARLY", qty=1,
                  trap="T47 waitlist for an off-sale tier", expect="TIER_NOT_ON_SALE")
        self.emit(minutes(at, 2), "WAITLIST_JOIN", "C-0014", target="Z", qty=1,
                  trap="T48 unknown waitlist target", expect="WAITLIST_TARGET_UNKNOWN")
        self.emit(minutes(at, 3), "WAITLIST_LEAVE", "C-0014", ref="W-9999", trap="T49 leave an unknown entry", expect="WAITLIST_UNKNOWN")

    def trap_refund_half(self, at):
        # 2027-03-01 is 19 days before: 50%, fee kept. ADV 3499 → 1749 (floor; 1 cent stays with the venue).
        eng = self.engine
        cands = sorted([o for o in eng.orders.values() if o["tier"] == "ADV" and o["confirmed_at"] < at
                        and all(eng.tickets[t]["state"] == "ISSUED" for t in o["tickets"])], key=lambda o: o["order_id"])
        o = cands[0]
        self.emit(at, "REFUND_REQUEST", o["customer"], ref=o["order_id"], tickets=[o["tickets"][0]],
                  trap="T50 half refund floors 3499 → 1749, fee kept (19 days)", expect="REFUNDED")
        assert eng.refunds[-1]["amount_cents"] == 1749, eng.refunds[-1]

    def trap_head_blocks(self, at):
        """Section C waitlist: head wants 4, second wants 2. A 2-seat refund must not skip the head."""
        eng = self.engine
        # By March 12 the balcony is sold out in the fixture (asserted) so joins are accepted.
        assert eng.contiguous_block("C", 2) is None, "section C must be sold out for T51"
        self.emit(at, "WAITLIST_JOIN", "C-0015", target="C", qty=4, trap="T51 head joins for 4", expect="WAITLISTED")
        self.emit(minutes(at, 1), "WAITLIST_JOIN", "C-0016", target="C", qty=2, trap="T52 second joins for 2", expect="WAITLISTED")
        self.emit(minutes(at, 2), "WAITLIST_JOIN", "C-0016", target="C", qty=2, trap="T53 same customer twice", expect="WAITLIST_DUPLICATE")
        head = eng.waitlist[-2]
        second = eng.waitlist[-1]
        # Refund a 2-seat section-C order (C-0009 holds C-F-03/04): the pair frees but the head wants 4 → nobody is offered
        oid = self.trap_orders["C-0009"]
        o = eng.orders[oid]
        self.emit(minutes(at, 3), "REFUND_REQUEST", "C-0009", ref=oid, tickets=list(o["tickets"]),
                  trap="T54 2 seats free (8 days: 50%)", expect="REFUNDED")
        assert head["state"] == "WAITING" and second["state"] == "WAITING", (head, second)
        self.answer_key.append(("STATE@" + minutes(at, 3), "HEAD_BLOCKS:W-%s WAITING, W-%s WAITING" % (
            head["entry_id"][2:], second["entry_id"][2:]), "T55 head blocks: 2 free, head wants 4, nobody offered"))
        # Refund a 4-seat section-C order → the head is offered those 4; the second then gets C-F-03/04 if it fits
        four = sorted([o for o in eng.orders.values() if o["tier"] == "BALC" and o["qty"] == 4
                       and all(s.startswith("C-") for s in o["seats"])
                       and all(eng.tickets[t]["state"] == "ISSUED" for t in o["tickets"])], key=lambda o: o["order_id"])
        assert four, "need a 4-seat section-C order"
        o4 = four[0]
        self.emit(minutes(at, 5), "REFUND_REQUEST", o4["customer"], ref=o4["order_id"], tickets=list(o4["tickets"]),
                  trap="T56 4 seats free → head offered", expect="REFUNDED")
        assert head["state"] == "OFFERED", head
        assert second["state"] == "OFFERED", second
        self.answer_key.append(("STATE@" + minutes(at, 5), "OFFERED:%s→%s %s→%s" % (
            head["entry_id"], head["offer_id"], second["entry_id"], second["offer_id"]),
            "T57 head offered the 4, second offered the 2"))
        # Wrong customer tries to pay the head's offer
        self.emit(minutes(at, 6), "PAY_START", "C-0016", ref=head["offer_id"], payment_id=self.new_pay_id(),
                  trap="T58 pay someone else's offer", expect="HOLD_NOT_YOURS")
        # Second accepts; the head ignores the offer → it expires 24h later and is dropped (DROP rule)
        pid = self.new_pay_id()
        self.handled_offers.add(head["offer_id"])
        self.handled_offers.add(second["offer_id"])
        self.emit(minutes(at, 7), "PAY_START", "C-0016", ref=second["offer_id"], payment_id=pid, trap="T59 accept offer", expect="PAYING")
        self.emit(minutes(at, 8), "PAY_SUCCEEDED", payment_id=pid, trap="T60 offer confirmed", expect="CONFIRMED")
        self.trap_head = head
        self.push(minutes(at, 5 + 1441), self.trap_offer_expired)

    def trap_offer_expired(self, at):
        head = self.trap_head
        # the 24h offer expired one minute before this command; advance() drops the entry on the way in
        self.emit(at, "PAY_START", "C-0015", ref=head["offer_id"], payment_id=self.new_pay_id(),
                  trap="T61 accepting an expired offer", expect="HOLD_EXPIRED")
        assert head["state"] == "OFFER_EXPIRED", head

    def trap_refund_closed_and_double(self, at):
        # 2027-03-15 is 5 days before: window closed
        eng = self.engine
        cands = sorted([o for o in eng.orders.values() if o["tier"] == "ADV" and o["confirmed_at"] < at
                        and all(eng.tickets[t]["state"] == "ISSUED" for t in o["tickets"])], key=lambda o: o["order_id"])
        o = cands[1]
        self.emit(at, "REFUND_REQUEST", o["customer"], ref=o["order_id"], tickets=list(o["tickets"]),
                  trap="T62 refund inside 7 days", expect="REFUND_WINDOW_CLOSED")

    def trap_door_not_on_sale(self, at):
        self.emit(at, "HOLD", "C-0017", ref=self.new_hold_id(), tier_id="DOOR", qty=2, trap="T63 DOOR before its on-sale",
                  expect="TIER_NOT_ON_SALE")
        self.emit(minutes(at, 1), "HOLD", "C-0017", ref=self.new_hold_id(), tier_id="EARLY", qty=2,
                  trap="T64 EARLY after its off-sale", expect="TIER_NOT_ON_SALE")

    def trap_checkin_before_doors(self, at):
        eng = self.engine
        tid = sorted(t for t, x in eng.tickets.items() if x["state"] == "ISSUED")[0]
        self.emit(at, "CHECK_IN", "", ref=tid, trap="T65 scan before doors", expect="DOORS_NOT_OPEN")
        self.trap_first_ticket = tid

    def trap_pool_boundary(self, at):
        """DOOR shows tier allotment left while the FLOOR pool is empty: the pool is the truth."""
        eng = self.engine
        pool_left = eng.pool_remaining("FLOOR")
        tier_left = eng.tier_remaining("DOOR")
        assert tier_left > pool_left, (tier_left, pool_left)
        # Fill the pool to exactly 1 remaining using one customer's hold, then prove the boundary
        t = at
        take = pool_left - 1
        while take > 0:
            q = min(8, take)
            hid = self.new_hold_id()
            self.emit(t, "HOLD", "C-0018", ref=hid, tier_id="DOOR", qty=q, note="box office fills the floor to one seat")
            pid = self.new_pay_id()
            self.emit(seconds(t, 10), "PAY_START", "C-0018", ref=hid, payment_id=pid)
            self.emit(seconds(t, 20), "PAY_SUCCEEDED", payment_id=pid)
            take -= q
            t = seconds(t, 30)
        assert eng.pool_remaining("FLOOR") == 1, eng.pool_remaining("FLOOR")
        t0 = minutes(t, 1)
        h = self.new_hold_id()
        self.emit(t0, "HOLD", "C-0019", ref=h, tier_id="DOOR", qty=1, trap="T66 last floor ticket held", expect="HELD")
        self.emit(minutes(t0, 1), "HOLD", "C-0020", ref=self.new_hold_id(), tier_id="DOOR", qty=1,
                  trap="T67 tier has allotment, pool has none", expect="SOLD_OUT_POOL")
        self.emit(minutes(t0, 2), "WAITLIST_JOIN", "C-0020", target="DOOR", qty=1, trap="T68 join DOOR waitlist", expect="WAITLISTED")
        w = eng.waitlist[-1]
        # C-0019 abandons; at exactly +10:00 the hold expires and the waitlist head is offered the ticket in the same tick
        self.emit(minutes(t0, 10), "HOLD", "C-0021", ref=self.new_hold_id(), tier_id="DOOR", qty=1,
                  trap="T69 expiry tick: the freed ticket went to the waitlist head, not to the walk-up", expect="SOLD_OUT_POOL")
        assert w["state"] == "OFFERED", w
        self.handled_offers.add(w["offer_id"])
        pid = self.new_pay_id()
        self.emit(minutes(t0, 11), "PAY_START", "C-0020", ref=w["offer_id"], payment_id=pid, trap="T70 head accepts", expect="PAYING")
        self.emit(seconds(minutes(t0, 11), 15), "PAY_SUCCEEDED", payment_id=pid, trap="T71 confirmed from the waitlist", expect="CONFIRMED")
        self.answer_key.append(("STATE@" + minutes(t0, 11), "FLOOR pool_remaining=%d DOOR tier_remaining=%d" % (
            eng.pool_remaining("FLOOR"), eng.tier_remaining("DOOR")), "T72 pool 0 while DOOR still shows allotment"))

    def trap_checkin_dupes(self, at):
        eng = self.engine
        tid = self.trap_first_ticket
        if eng.tickets[tid]["state"] == "ISSUED":
            self.emit(at, "CHECK_IN", "", ref=tid, trap="T73 scan", expect="CHECKED_IN")
        self.emit(minutes(at, 1), "CHECK_IN", "", ref=tid, trap="T74 second scan of the same ticket", expect="ALREADY_CHECKED_IN")
        ref = sorted(t for t, x in eng.tickets.items() if x["state"] == "REFUNDED")[0]
        self.emit(minutes(at, 2), "CHECK_IN", "", ref=ref, trap="T75 scan a refunded ticket", expect="TICKET_REFUNDED")
        self.emit(minutes(at, 3), "CHECK_IN", "", ref="T-99999", trap="T76 unknown ticket", expect="TICKET_UNKNOWN")
        o = eng.orders[eng.tickets[tid]["order_id"]]
        self.emit(minutes(at, 4), "REFUND_REQUEST", o["customer"], ref=o["order_id"], tickets=[tid],
                  trap="T77 refund after check-in", expect="TICKET_CHECKED_IN")

    def trap_after_close(self, at):
        self.emit(at, "HOLD", "C-0022", ref=self.new_hold_id(), tier_id="DOOR", qty=1, trap="T78 after sales close",
                  expect="SALES_CLOSED")
        self.emit(minutes(at, 1), "WAITLIST_JOIN", "C-0022", target="DOOR", qty=1, trap="T79 waitlist after close",
                  expect="SALES_CLOSED")

    # ------------------------------------------------------------ run
    def run(self):
        self.seed_demand()
        self.seed_traps()
        while self.heap:
            at, _, fn, args = heapq.heappop(self.heap)
            fn(at, *args)
        return self.commands


def write_csv(path, rows, fields):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261109)
    ap.add_argument("--out", default="fixtures")
    a = ap.parse_args()
    sim = Sim(a.seed)
    cmds = sim.run()
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "event.json"), "w") as f:
        json.dump(EVENT, f, indent=2, sort_keys=True)
        f.write("\n")
    write_csv(os.path.join(a.out, "customers.csv"), sim.customers, ["customer_id", "name", "email"])
    rows = []
    for c in cmds:
        r = dict(c)
        r["seats"] = " ".join(c["seats"])
        r["tickets"] = " ".join(c["tickets"])
        rows.append(r)
    write_csv(os.path.join(a.out, "commands.csv"), rows,
              ["cmd_id", "at", "kind", "customer", "ref", "tier_id", "qty", "seats", "payment_id", "target", "tickets", "note"])
    write_csv(os.path.join(a.out, "answer_key.csv"),
              [{"cmd_id": k, "expected": e, "trap": t} for k, e, t in sim.answer_key],
              ["cmd_id", "expected", "trap"])
    s = sim.engine.summary()
    print("seed %d: %d commands, %d ok, %d rejected, %d orders, %d tickets, %d traps keyed" % (
        a.seed, s["commands"], s["ok"], s["rejected"], s["orders"], s["tickets_issued"], len(sim.answer_key)))
    for name in ("event.json", "customers.csv", "commands.csv", "answer_key.csv"):
        with open(os.path.join(a.out, name), "rb") as f:
            print("  %s  %s" % (hashlib.sha256(f.read()).hexdigest(), name))


if __name__ == "__main__":
    main()
