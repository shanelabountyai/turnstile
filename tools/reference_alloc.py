#!/usr/bin/env python3
"""Run the oracle over fixtures/ and print the reference table (stdlib only).

Usage:
  python3 -I tools/reference_alloc.py [--fixtures fixtures] [--write-expected] [--shuffle N]

--write-expected writes fixtures/expected_commands.csv, expected_inventory.csv,
expected_orders.csv, expected_tickets.csv, expected_waitlist.csv,
expected_refunds.csv and expected_summary.json.
--shuffle N re-runs the engine on N seeded shuffles of commands.csv and asserts
identical outputs (order independence, D-7).
"""

import argparse
import csv
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventorylib as lib  # noqa: E402


def load_commands(path):
    out = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            out.append({"cmd_id": r["cmd_id"], "at": r["at"], "kind": r["kind"], "customer": r["customer"],
                        "ref": r["ref"], "tier_id": r["tier_id"], "qty": int(r["qty"] or 0),
                        "seats": r["seats"].split() if r["seats"] else [],
                        "payment_id": r["payment_id"], "target": r["target"],
                        "tickets": r["tickets"].split() if r["tickets"] else [], "note": r["note"]})
    return out


def run(fixtures, commands=None):
    with open(os.path.join(fixtures, "event.json")) as f:
        ev = json.load(f)
    cmds = commands if commands is not None else load_commands(os.path.join(fixtures, "commands.csv"))
    eng = lib.Engine(ev)
    eng.run(cmds)
    return eng


def expected_tables(eng):
    commands = [{"cmd_id": r["cmd_id"], "at": r["at"], "kind": r["kind"], "customer": r["customer"],
                 "status": r["status"], "code": r["code"], "detail": r["detail"]} for r in eng.results]
    inventory = eng.inventory_rows()
    orders = [{"order_id": o["order_id"], "customer": o["customer"], "tier": o["tier"], "qty": o["qty"],
               "seats": " ".join(o["seats"]), "gross_cents": o["gross_cents"], "fees_cents": o["fees_cents"],
               "refunded_cents": sum(eng.tickets[t]["refunded_cents"] for t in o["tickets"]),
               "payment_id": o["payment_id"], "confirmed_at": o["confirmed_at"], "via_offer": int(o["via_offer"]),
               "tickets": " ".join(o["tickets"])} for o in sorted(eng.orders.values(), key=lambda o: o["order_id"])]
    tickets = [{"ticket_id": t["ticket_id"], "order_id": t["order_id"], "tier": t["tier"], "seat": t["seat"],
                "price_cents": t["price_cents"], "fee_cents": t["fee_cents"], "state": t["state"],
                "refunded_cents": t["refunded_cents"], "checked_in_at": t["checked_in_at"] or "", "code": t["code"]}
               for t in sorted(eng.tickets.values(), key=lambda t: t["ticket_id"])]
    waitlist = [{"entry_id": e["entry_id"], "customer": e["customer"], "target": e["target"], "qty": e["qty"],
                 "joined_at": e["joined_at"], "state": e["state"], "offer_id": e["offer_id"] or "",
                 "offered_at": e["offered_at"] or "", "ended_at": e["ended_at"] or "", "order_id": e["order_id"] or ""}
                for e in eng.waitlist]
    refunds = [dict(r) for r in eng.refunds]
    return commands, inventory, orders, tickets, waitlist, refunds, eng.summary()


def write_csv(path, rows, fields):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def print_table(eng, ev):
    c, inv, orders, tickets, wl, refunds, s = expected_tables(eng)
    print("== Turnstile reference run — %s" % ev["name"])
    print("commands %d · ok %d · rejected %d" % (s["commands"], s["ok"], s["rejected"]))
    print("-- by code")
    for code in sorted(s["by_code"], key=lambda k: (-s["by_code"][k], k)):
        print("  %-28s %5d" % (code, s["by_code"][code]))
    print("-- inventory (end state)")
    print("  %-5s %-8s %8s %5s %5s %8s %9s %9s" % ("scope", "id", "capacity", "sold", "held", "refunded", "remaining", "available"))
    for r in inv:
        print("  %-5s %-8s %8d %5d %5d %8d %9d %9d" % (r["scope"], r["id"], r["capacity"], r["sold"], r["held"],
                                                      r["refunded"], r["remaining"], r["available"]))
    print("-- orders %d · tickets issued %d · live %d · refunded %d · checked in %d" % (
        s["orders"], s["tickets_issued"], s["tickets_live"], s["tickets_refunded"], s["checked_in"]))
    print("-- money (cents): captured %d · refunded %d · net %d · refunds %d" % (
        s["captured_cents"], s["refunded_cents"], s["net_cents"], s["refunds"]))
    by_reason = {}
    for r in refunds:
        k = r["reason"].split("_")[0] if r["reason"].startswith("CUSTOMER") else r["reason"]
        by_reason.setdefault(k, [0, 0])
        by_reason[k][0] += 1
        by_reason[k][1] += r["amount_cents"]
    for k in sorted(by_reason):
        print("  refunds %-20s %4d  %9d" % (k, by_reason[k][0], by_reason[k][1]))
    print("-- holds")
    for k in sorted(s["holds"]):
        print("  %-22s %5d" % (k, s["holds"][k]))
    print("-- waitlist: entries %d · offers made %d" % (len(wl), s["offers_made"]))
    for k in sorted(s["waitlist"]):
        print("  %-22s %5d" % (k, s["waitlist"][k]))
    print("-- commitment %s" % s["commitment"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="fixtures")
    ap.add_argument("--write-expected", action="store_true")
    ap.add_argument("--shuffle", type=int, default=0)
    a = ap.parse_args()
    with open(os.path.join(a.fixtures, "event.json")) as f:
        ev = json.load(f)
    cmds = load_commands(os.path.join(a.fixtures, "commands.csv"))
    eng = run(a.fixtures, cmds)
    print_table(eng, ev)
    tables = expected_tables(eng)
    if a.shuffle:
        base = json.dumps(tables, sort_keys=True, default=str)
        for i in range(a.shuffle):
            sh = list(cmds)
            random.Random(1000 + i).shuffle(sh)
            e2 = run(a.fixtures, sh)
            if json.dumps(expected_tables(e2), sort_keys=True, default=str) != base:
                print("SHUFFLE %d DIFFERS" % i)
                sys.exit(1)
        print("shuffle: %d orders of commands.csv → identical tables and commitment" % a.shuffle)
    if a.write_expected:
        c, inv, orders, tickets, wl, refunds, s = tables
        write_csv(os.path.join(a.fixtures, "expected_commands.csv"), c, ["cmd_id", "at", "kind", "customer", "status", "code", "detail"])
        write_csv(os.path.join(a.fixtures, "expected_inventory.csv"), inv,
                  ["scope", "id", "pool", "capacity", "sold", "held", "refunded", "remaining", "available"])
        write_csv(os.path.join(a.fixtures, "expected_orders.csv"), orders,
                  ["order_id", "customer", "tier", "qty", "seats", "gross_cents", "fees_cents", "refunded_cents",
                   "payment_id", "confirmed_at", "via_offer", "tickets"])
        write_csv(os.path.join(a.fixtures, "expected_tickets.csv"), tickets,
                  ["ticket_id", "order_id", "tier", "seat", "price_cents", "fee_cents", "state", "refunded_cents",
                   "checked_in_at", "code"])
        write_csv(os.path.join(a.fixtures, "expected_waitlist.csv"), wl,
                  ["entry_id", "customer", "target", "qty", "joined_at", "state", "offer_id", "offered_at", "ended_at", "order_id"])
        write_csv(os.path.join(a.fixtures, "expected_refunds.csv"), refunds,
                  ["refund_id", "order_id", "ticket_id", "payment_id", "amount_cents", "reason", "at"])
        with open(os.path.join(a.fixtures, "expected_summary.json"), "w") as f:
            json.dump(s, f, indent=2, sort_keys=True)
            f.write("\n")
        print("wrote expected_*.csv and expected_summary.json")


if __name__ == "__main__":
    main()
