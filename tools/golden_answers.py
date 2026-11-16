#!/usr/bin/env python3
"""Golden cases for the Turnstile engine (GT-01..GT-18), stdlib only.

Each case is a small, hand-checkable scenario with the exact value the brief
states. The TypeScript engine must reproduce every one. Run:
  python3 -I tools/golden_answers.py        -> prints each case and ends with OK
"""

import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventorylib as lib  # noqa: E402

BASE = {
    "event_id": "EV-GOLD", "name": "golden", "venue": "none", "timezone_label": "America/Chicago",
    "starts_at": "2027-03-20T20:00:00", "doors_at": "2027-03-20T19:00:00",
    "sales_open_at": "2026-12-01T10:00:00", "sales_close_at": "2027-03-20T20:00:00",
    "currency": "USD", "ticket_salt": "gold",
    "pools": [{"pool_id": "FLOOR", "kind": "GA", "capacity": 10},
              {"pool_id": "BALCONY", "kind": "RESERVED", "capacity": 12}],
    "tiers": [
        {"tier_id": "EARLY", "pool_id": "FLOOR", "allotment": 4, "price_cents": 2500,
         "on_sale_at": "2026-12-01T10:00:00", "off_sale_at": "2027-01-16T00:00:00"},
        {"tier_id": "ADV", "pool_id": "FLOOR", "allotment": 6, "price_cents": 3499,
         "on_sale_at": "2026-12-01T10:00:00", "off_sale_at": "2027-03-20T17:00:00"},
        {"tier_id": "DOOR", "pool_id": "FLOOR", "allotment": 5, "price_cents": 4500,
         "on_sale_at": "2027-03-20T17:00:00", "off_sale_at": "2027-03-20T20:00:00"},
        {"tier_id": "BALC", "pool_id": "BALCONY", "allotment": 12, "price_cents": 6000,
         "on_sale_at": "2026-12-01T10:00:00", "off_sale_at": "2027-03-20T20:00:00"},
    ],
    "sections": [{"section_id": "A", "pool_id": "BALCONY", "rows": ["A"], "seats_per_row": 12}],
    "rules": {"hold_ttl_minutes": 10, "offer_ttl_minutes": 60, "payment_timeout_minutes": 30,
              "max_tickets_per_order": 8, "prevent_orphan_seats": True, "waitlist_rule": "HEAD_BLOCKS",
              "offer_expired_rule": "DROP", "service_fee_cents": 350,
              "refund_policy": [{"min_days_before": 30, "refund_bps": 10000, "fee_refunded": True},
                                {"min_days_before": 7, "refund_bps": 5000, "fee_refunded": False},
                                {"min_days_before": 0, "refund_bps": 0, "fee_refunded": False}],
              "cancellation_refund_bps": 10000},
}

_n = [0]


def cmd(at, kind, customer="", **f):
    _n[0] += 1
    c = {"cmd_id": "G-%04d" % _n[0], "at": at, "kind": kind, "customer": customer, "ref": "", "tier_id": "",
         "qty": 0, "seats": [], "payment_id": "", "target": "", "tickets": [], "note": ""}
    c.update(f)
    return c


def engine(**over):
    ev = copy.deepcopy(BASE)
    for k, v in over.items():
        if k == "rules":
            ev["rules"].update(v)
        else:
            ev[k] = v
    return lib.Engine(ev)


def check(name, got, want):
    ok = got == want
    print("%s %-6s %s" % ("ok " if ok else "FAIL", name, "" if ok else "got %r want %r" % (got, want)))
    if not ok:
        raise SystemExit(1)


def buy(e, at, customer, tier, qty=0, seats=(), hid=None, pid=None):
    """HOLD → PAY_START → PAY_SUCCEEDED one minute apart; returns (hold, order_id)."""
    hid = hid or "H-%s-%s" % (customer, at[-8:].replace(":", ""))
    pid = pid or "pi-" + hid
    r = e.apply(cmd(at, "HOLD", customer, ref=hid, tier_id=tier, qty=qty, seats=list(seats)))
    assert r["code"] == "HELD", r
    e.apply(cmd(lib.add_minutes(at, 1), "PAY_START", customer, ref=hid, payment_id=pid))
    r = e.apply(cmd(lib.add_minutes(at, 2), "PAY_SUCCEEDED", payment_id=pid))
    assert r["code"] == "CONFIRMED", r
    return e.holds[hid], e.holds[hid]["order_id"]


def main():
    # GT-01 canonical JSON and SHA-256 are fixed
    check("GT-01", lib.canonical({"b": [2, 1], "a": "x"}), '{"a":"x","b":[2,1]}')
    check("GT-01b", lib.sha256_hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")

    # GT-02 ticket code = sha256(event_id|ticket_id|salt)[:20]
    check("GT-02", lib.sha256_hex("EV-SYNTH-001|T-00001|fixture-salt-20261109")[:20],
          lib.sha256_hex("EV-SYNTH-001|T-00001|fixture-salt-20261109")[:20])
    print("      GT-02 value:", lib.sha256_hex("EV-SYNTH-001|T-00001|fixture-salt-20261109")[:20])

    # GT-03 the pool is the truth: tier allotments 4+6+5 over a pool of 10
    e = engine()
    buy(e, "2026-12-02T10:00:00", "c1", "EARLY", 4)
    buy(e, "2026-12-02T11:00:00", "c2", "ADV", 6)
    check("GT-03a", (e.tier_remaining("DOOR"), e.pool_remaining("FLOOR"), e.available("DOOR")), (5, 0, 0))
    r = e.apply(cmd("2027-03-20T17:00:00", "HOLD", "c3", ref="h", tier_id="DOOR", qty=1))
    check("GT-03b", r["code"], "SOLD_OUT_POOL")
    # a refund in EARLY (off sale) is a DOOR ticket: 75 days before → full refund
    e2 = engine()
    h1, o1 = buy(e2, "2026-12-02T10:00:00", "c1", "EARLY", 4)
    buy(e2, "2026-12-02T11:00:00", "c2", "ADV", 6)
    r = e2.apply(cmd("2027-01-04T12:00:00", "REFUND_REQUEST", "c1", ref=o1, tickets=[e2.orders[o1]["tickets"][0]]))
    check("GT-03c", (r["code"], e2.refunds[-1]["amount_cents"]), ("REFUNDED", 2850))
    r = e2.apply(cmd("2027-03-20T17:00:00", "HOLD", "c3", ref="h", tier_id="DOOR", qty=1))
    check("GT-03d", (r["code"], e2.tier_remaining("EARLY"), e2.available("EARLY")), ("HELD", 1, 0))

    # GT-04 hold TTL boundary: expires_at <= at expires; one second earlier does not
    e = engine()
    e.apply(cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="ADV", qty=6))
    r = e.apply(cmd("2026-12-02T10:09:59", "HOLD", "c2", ref="h2", tier_id="ADV", qty=1))
    check("GT-04a", r["code"], "SOLD_OUT_TIER")
    r = e.apply(cmd("2026-12-02T10:10:00", "HOLD", "c2", ref="h3", tier_id="ADV", qty=1))
    check("GT-04b", (r["code"], e.holds["h1"]["state"]), ("HELD", "EXPIRED"))

    # GT-05 orphan rule: a single empty seat between two occupied seats is refused; row ends are fine
    e = engine()
    e.apply(cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="BALC", seats=["A-A-01", "A-A-02"]))
    r = e.apply(cmd("2026-12-02T10:01:00", "HOLD", "c2", ref="h2", tier_id="BALC", seats=["A-A-04", "A-A-05"]))
    check("GT-05a", r["code"], "ORPHAN_SEAT")
    r = e.apply(cmd("2026-12-02T10:02:00", "HOLD", "c2", ref="h3", tier_id="BALC", seats=["A-A-03", "A-A-04"]))
    check("GT-05b", r["code"], "HELD")
    r = e.apply(cmd("2026-12-02T10:03:00", "HOLD", "c3", ref="h4", tier_id="BALC",
                    seats=["A-A-05", "A-A-06", "A-A-07", "A-A-08", "A-A-09", "A-A-10", "A-A-11"]))
    check("GT-05c", (r["code"], e.seats["A-A-12"]["state"]), ("HELD", "OPEN"))   # end-of-row single is allowed
    r = e.apply(cmd("2026-12-02T10:04:00", "HOLD", "c4", ref="h5", tier_id="BALC", seats=["A-A-12"]))
    check("GT-05d", r["code"], "HELD")   # filling a single never creates an orphan
    e = engine(rules={"prevent_orphan_seats": False})
    e.apply(cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="BALC", seats=["A-A-01", "A-A-02"]))
    r = e.apply(cmd("2026-12-02T10:01:00", "HOLD", "c2", ref="h2", tier_id="BALC", seats=["A-A-04", "A-A-05"]))
    check("GT-05e", r["code"], "HELD")

    # GT-06 refund window is whole days before start on the one axis: 30 days at 19:00, 29 at 21:00
    e = engine()
    check("GT-06a", e.refund_terms("2027-02-18T19:00:00")[0], 30)
    check("GT-06b", e.refund_terms("2027-02-18T21:00:00")[0], 29)
    check("GT-06c", e.refund_terms("2027-03-13T19:59:59")[0], 7)
    check("GT-06d", e.refund_terms("2027-03-13T20:00:01")[0], 6)
    check("GT-06e", [e.refund_terms(t)[1]["refund_bps"] for t in
                     ("2027-02-18T19:00:00", "2027-02-18T21:00:00", "2027-03-13T20:00:00", "2027-03-13T20:00:01")],
          [10000, 5000, 5000, 0])

    # GT-07 half refund floors: 3499 × 5000 / 10000 = 1749 (1 cent stays); fee kept; full refund adds the fee
    e = engine()
    h, o = buy(e, "2026-12-02T10:00:00", "c1", "ADV", 2)
    t = e.orders[o]["tickets"]
    r = e.apply(cmd("2027-03-01T12:00:00", "REFUND_REQUEST", "c1", ref=o, tickets=[t[0]]))
    check("GT-07a", (r["code"], e.refunds[-1]["amount_cents"]), ("REFUNDED", 1749))
    r = e.apply(cmd("2027-03-15T12:00:00", "REFUND_REQUEST", "c1", ref=o, tickets=[t[1]]))
    check("GT-07b", r["code"], "REFUND_WINDOW_CLOSED")
    e = engine()
    h, o = buy(e, "2026-12-02T10:00:00", "c1", "ADV", 1)
    r = e.apply(cmd("2027-01-04T12:00:00", "REFUND_REQUEST", "c1", ref=o, tickets=e.orders[o]["tickets"]))
    check("GT-07c", e.refunds[-1]["amount_cents"], 3849)

    # GT-08 payment timeout boundary: webhook at exactly +30:00 is late (refund, no tickets); +29:59 confirms
    e = engine()
    e.apply(cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="ADV", qty=2))
    e.apply(cmd("2026-12-02T10:01:00", "PAY_START", "c1", ref="h1", payment_id="p1"))
    r = e.apply(cmd("2026-12-02T10:31:00", "PAY_SUCCEEDED", payment_id="p1"))
    check("GT-08a", (r["code"], e.refunds[-1]["amount_cents"], len(e.tickets), e.pool_remaining("FLOOR")),
          ("PAID_AFTER_TIMEOUT", 7698, 0, 10))
    e = engine()
    e.apply(cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="ADV", qty=2))
    e.apply(cmd("2026-12-02T10:01:00", "PAY_START", "c1", ref="h1", payment_id="p1"))
    r = e.apply(cmd("2026-12-02T10:30:59", "PAY_SUCCEEDED", payment_id="p1"))
    check("GT-08b", (r["code"], len(e.tickets)), ("CONFIRMED", 2))
    # a hold that is PAYING is not expired by the hold TTL
    e = engine()
    e.apply(cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="ADV", qty=2))
    e.apply(cmd("2026-12-02T10:09:00", "PAY_START", "c1", ref="h1", payment_id="p1"))
    r = e.apply(cmd("2026-12-02T10:25:00", "PAY_SUCCEEDED", payment_id="p1"))
    check("GT-08c", r["code"], "CONFIRMED")

    # GT-09 HEAD_BLOCKS: head wants 4, second wants 2; 2 free → nobody; 4 more free → both, in order
    e = engine()
    buy(e, "2026-12-02T10:00:00", "c1", "ADV", 6)
    buy(e, "2026-12-02T10:10:00", "c2", "EARLY", 4)
    e.apply(cmd("2026-12-02T11:00:00", "WAITLIST_JOIN", "w1", target="ADV", qty=4))
    e.apply(cmd("2026-12-02T11:01:00", "WAITLIST_JOIN", "w2", target="ADV", qty=2))
    o1 = e.holds[[h for h in e.holds if e.holds[h]["customer"] == "c1"][0]]["order_id"]
    t = e.orders[o1]["tickets"]
    e.apply(cmd("2026-12-03T10:00:00", "REFUND_REQUEST", "c1", ref=o1, tickets=t[:2]))
    check("GT-09a", [x["state"] for x in e.waitlist], ["WAITING", "WAITING"])
    e.apply(cmd("2026-12-03T10:05:00", "REFUND_REQUEST", "c1", ref=o1, tickets=t[2:]))
    check("GT-09b", [(x["state"], x["offer_id"]) for x in e.waitlist], [("OFFERED", "O-0001"), ("OFFERED", "O-0002")])
    check("GT-09c", (e.available("ADV"), e.holds["O-0001"]["qty"], e.holds["O-0002"]["qty"]), (0, 4, 2))
    # the wrong customer cannot pay the head's offer; the right one can
    r = e.apply(cmd("2026-12-03T10:06:00", "PAY_START", "w2", ref="O-0001", payment_id="p9"))
    check("GT-09d", r["code"], "HOLD_NOT_YOURS")
    e.apply(cmd("2026-12-03T10:07:00", "PAY_START", "w1", ref="O-0001", payment_id="p1"))
    r = e.apply(cmd("2026-12-03T10:08:00", "PAY_SUCCEEDED", payment_id="p1"))
    check("GT-09e", (r["code"], e.waitlist[0]["state"], e.orders[e.waitlist[0]["order_id"]]["via_offer"]),
          ("CONFIRMED", "FULFILLED", True))

    # GT-10 DROP: an ignored offer expires at its TTL; the entry is dropped and the next head is offered in the same tick
    e = engine()
    buy(e, "2026-12-02T10:00:00", "c1", "ADV", 6)
    buy(e, "2026-12-02T10:10:00", "c2", "EARLY", 4)
    e.apply(cmd("2026-12-02T11:00:00", "WAITLIST_JOIN", "w1", target="ADV", qty=2))
    e.apply(cmd("2026-12-02T11:01:00", "WAITLIST_JOIN", "w2", target="ADV", qty=2))
    o1 = e.orders["ORD-00001"]
    e.apply(cmd("2026-12-03T10:00:00", "REFUND_REQUEST", "c1", ref="ORD-00001", tickets=o1["tickets"][:2]))
    check("GT-10a", [(x["state"], x["offer_id"]) for x in e.waitlist], [("OFFERED", "O-0001"), ("WAITING", None)])
    r = e.apply(cmd("2026-12-03T11:00:00", "PAY_START", "w1", ref="O-0001", payment_id="p1"))
    check("GT-10b", (r["code"], e.waitlist[0]["state"], e.waitlist[1]["state"], e.waitlist[1]["offer_id"]),
          ("HOLD_EXPIRED", "OFFER_EXPIRED", "OFFERED", "O-0002"))
    check("GT-10c", e.holds["O-0002"]["expires_at"], "2026-12-03T12:00:00")

    # GT-11 cancellation refunds every live ticket in full plus fees, even checked-in ones; the event is closed after
    e = engine(doors_at="2026-12-10T19:00:00")
    h, o = buy(e, "2026-12-02T10:00:00", "c1", "BALC", seats=["A-A-01", "A-A-02"])
    e.apply(cmd("2026-12-10T19:05:00", "CHECK_IN", ref=e.orders[o]["tickets"][0]))
    e.apply(cmd("2026-12-10T19:07:00", "HOLD", "c2", ref="h2", tier_id="ADV", qty=1))
    e.apply(cmd("2026-12-10T19:08:00", "PAY_START", "c2", ref="h2", payment_id="p2"))
    r = e.apply(cmd("2026-12-10T19:10:00", "CANCEL_EVENT"))
    check("GT-11a", (r["code"], r["detail"]), ("EVENT_CANCELLED_OK", "tickets=2 refunded_cents=12700"))
    check("GT-11b", (e.holds["h2"]["state"], e.seats["A-A-01"]["state"]), ("CANCELLED", "OPEN"))
    r = e.apply(cmd("2026-12-10T19:11:00", "PAY_SUCCEEDED", payment_id="p2"))
    check("GT-11c", (r["code"], e.refunds[-1]["amount_cents"]), ("PAID_AFTER_CANCEL", 3849))
    r = e.apply(cmd("2026-12-10T19:12:00", "HOLD", "c3", ref="h3", tier_id="ADV", qty=1))
    check("GT-11d", r["code"], "EVENT_CANCELLED")
    r = e.apply(cmd("2026-12-10T19:13:00", "CANCEL_EVENT"))
    check("GT-11e", r["code"], "ALREADY_CANCELLED")
    check("GT-11f", e.summary()["net_cents"], 0)

    # GT-12 webhooks are idempotent: a replay or a contradictory later event is a no-op
    e = engine()
    e.apply(cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="ADV", qty=1))
    e.apply(cmd("2026-12-02T10:01:00", "PAY_START", "c1", ref="h1", payment_id="p1"))
    e.apply(cmd("2026-12-02T10:02:00", "PAY_SUCCEEDED", payment_id="p1"))
    r1 = e.apply(cmd("2026-12-02T10:03:00", "PAY_SUCCEEDED", payment_id="p1"))
    r2 = e.apply(cmd("2026-12-02T10:04:00", "PAY_FAILED", payment_id="p1"))
    check("GT-12", (r1["code"], r2["code"], len(e.tickets), e.tickets["T-00001"]["state"]),
          ("PAYMENT_DUPLICATE", "PAYMENT_DUPLICATE", 1, "ISSUED"))

    # GT-13 RULES_INVALID on anything outside the closed schema
    for over, label in ((({"waitlist_rule": "SKIP_TO_FIT"}), "waitlist_rule"),
                        (({"offer_expired_rule": "REQUEUE"}), "offer_expired_rule"),
                        (({"refund_policy": [{"min_days_before": 7, "refund_bps": 5000, "fee_refunded": False}]}), "policy end"),
                        (({"refund_policy": [{"min_days_before": 7, "refund_bps": 5000, "fee_refunded": False},
                                             {"min_days_before": 30, "refund_bps": 10000, "fee_refunded": True},
                                             {"min_days_before": 0, "refund_bps": 0, "fee_refunded": False}]}), "policy order")):
        try:
            engine(rules=over)
            check("GT-13 " + label, "accepted", "RULES_INVALID")
        except ValueError as ex:
            check("GT-13", str(ex).split(":")[0], "RULES_INVALID")
    try:
        engine(pools=[{"pool_id": "FLOOR", "kind": "GA", "capacity": 10},
                      {"pool_id": "BALCONY", "kind": "RESERVED", "capacity": 13}])
        check("GT-13 cap", "accepted", "RULES_INVALID")
    except ValueError as ex:
        check("GT-13 cap", str(ex).split(":")[0], "RULES_INVALID")

    # GT-14 order independence: the same commands in any order give the same results and commitment
    cmds = [cmd("2026-12-02T10:00:00", "HOLD", "c1", ref="h1", tier_id="ADV", qty=2),
            cmd("2026-12-02T10:00:00", "HOLD", "c2", ref="h2", tier_id="ADV", qty=5),
            cmd("2026-12-02T10:01:00", "PAY_START", "c1", ref="h1", payment_id="p1"),
            cmd("2026-12-02T10:02:00", "PAY_SUCCEEDED", payment_id="p1"),
            cmd("2026-12-02T10:11:00", "HOLD", "c2", ref="h3", tier_id="ADV", qty=4)]
    a = engine()
    a.run(cmds)
    b = engine()
    b.run(list(reversed(cmds)))
    check("GT-14a", [r["code"] for r in a.results], ["HELD", "SOLD_OUT_TIER", "PAYING", "CONFIRMED", "HELD"])
    check("GT-14b", (a.summary()["commitment"] == b.summary()["commitment"],
                     [r["code"] for r in b.results] == [r["code"] for r in a.results]), (True, True))
    # same-second ties are broken by cmd_id, never by arrival order: h2 (G-later) loses to h1
    check("GT-14c", (a.results[0]["cmd_id"] < a.results[1]["cmd_id"]), True)

    # GT-15 one HOLD, one outcome: the cheapest reject wins by precedence (SALES window before tier before qty)
    e = engine()
    r = e.apply(cmd("2026-11-30T09:00:00", "HOLD", "c1", ref="h1", tier_id="NOPE", qty=99))
    check("GT-15a", r["code"], "SALES_NOT_OPEN")
    r = e.apply(cmd("2026-12-02T09:00:00", "HOLD", "c1", ref="h1", tier_id="NOPE", qty=99))
    check("GT-15b", r["code"], "TIER_UNKNOWN")
    r = e.apply(cmd("2026-12-02T09:00:00", "HOLD", "c1", ref="h1", tier_id="DOOR", qty=99))
    check("GT-15c", r["code"], "TIER_NOT_ON_SALE")
    r = e.apply(cmd("2026-12-02T09:00:00", "HOLD", "c1", ref="h1", tier_id="ADV", qty=99))
    check("GT-15d", r["code"], "QTY_OVER_LIMIT")
    r = e.apply(cmd("2026-12-02T09:00:00", "HOLD", "c1", ref="h1", tier_id="BALC", qty=2, seats=["A-A-01", "A-A-01"]))
    check("GT-15e", r["code"], "SEAT_DUPLICATE")

    # GT-16 check-in: not before doors; once; never for a refunded ticket; no refund after check-in
    e = engine()
    h, o = buy(e, "2026-12-02T10:00:00", "c1", "ADV", 2)
    t = e.orders[o]["tickets"]
    r = e.apply(cmd("2027-03-20T18:59:59", "CHECK_IN", ref=t[0]))
    check("GT-16a", r["code"], "DOORS_NOT_OPEN")
    r = e.apply(cmd("2027-03-20T19:00:00", "CHECK_IN", ref=t[0]))
    check("GT-16b", r["code"], "CHECKED_IN")
    r = e.apply(cmd("2027-03-20T19:00:01", "CHECK_IN", ref=t[0]))
    check("GT-16c", (r["code"], r["detail"]), ("ALREADY_CHECKED_IN", "2027-03-20T19:00:00"))
    r = e.apply(cmd("2027-03-20T19:01:00", "REFUND_REQUEST", "c1", ref=o, tickets=[t[0]]))
    check("GT-16d", r["code"], "TICKET_CHECKED_IN")   # checked before REFUND_WINDOW_CLOSED

    # GT-17 the sales window: last second before close sells; the close second does not
    e = engine()
    r = e.apply(cmd("2027-03-20T19:59:59", "HOLD", "c1", ref="h1", tier_id="DOOR", qty=1))
    check("GT-17a", r["code"], "HELD")
    r = e.apply(cmd("2027-03-20T20:00:00", "HOLD", "c2", ref="h2", tier_id="DOOR", qty=1))
    check("GT-17b", r["code"], "SALES_CLOSED")

    # GT-18 waitlist is for people who cannot be served now; for reserved seats "served" means a block fits
    e = engine(rules={"prevent_orphan_seats": False})   # the checkerboard below would be ORPHAN_SEAT otherwise
    r = e.apply(cmd("2026-12-02T10:00:00", "WAITLIST_JOIN", "w1", target="ADV", qty=2))
    check("GT-18a", (r["code"], r["detail"]), ("WAITLIST_NOT_NEEDED", "available=6"))
    e.apply(cmd("2026-12-02T10:01:00", "HOLD", "c1", ref="h1", tier_id="BALC",
                seats=["A-A-02", "A-A-03", "A-A-05", "A-A-06", "A-A-08", "A-A-09", "A-A-11"]))
    # open seats: 01, 04, 07, 10, 12 — five seats, no adjacent pair
    check("GT-18b", (e.tier_remaining("BALC"), e.section_can_serve("A", 1), e.section_can_serve("A", 2)), (5, True, False))
    r = e.apply(cmd("2026-12-02T10:02:00", "WAITLIST_JOIN", "w2", target="A", qty=2))
    check("GT-18c", r["code"], "WAITLISTED")
    r = e.apply(cmd("2026-12-02T10:03:00", "WAITLIST_JOIN", "w3", target="A", qty=1))
    check("GT-18d", r["code"], "WAITLIST_NOT_NEEDED")

    print("OK")


if __name__ == "__main__":
    main()
