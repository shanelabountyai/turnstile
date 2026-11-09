#!/usr/bin/env python3
"""Verify the frozen fixtures (stdlib only). Ends with OK or exits 1.

Checks:
  1. every file in fixtures/MANIFEST.json has the recorded sha256 (--write-manifest records them);
  2. re-running the oracle over commands.csv reproduces expected_*.csv byte for byte;
  3. every trap in answer_key.csv has the expected code in expected_commands.csv;
  4. the answer key covers every REJECT code the fixture exercises at least once (reported, not fatal),
     and the by-code table in expected_summary.json matches the recount.

Usage: python3 -I tools/verify_fixtures.py [--fixtures fixtures] [--write-manifest]
"""

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
import tempfile

FILES = ["event.json", "customers.csv", "commands.csv", "answer_key.csv",
         "expected_commands.csv", "expected_inventory.csv", "expected_orders.csv", "expected_tickets.csv",
         "expected_waitlist.csv", "expected_refunds.csv", "expected_summary.json"]


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="fixtures")
    ap.add_argument("--write-manifest", action="store_true")
    a = ap.parse_args()
    fx = a.fixtures
    tools = os.path.dirname(os.path.abspath(__file__))
    bad = 0

    hashes = {name: sha(os.path.join(fx, name)) for name in FILES}
    mpath = os.path.join(fx, "MANIFEST.json")
    if a.write_manifest:
        with open(mpath, "w") as f:
            json.dump({"seed": 20261109, "files": hashes}, f, indent=2, sort_keys=True)
            f.write("\n")
        print("wrote MANIFEST.json")
    with open(mpath) as f:
        manifest = json.load(f)
    for name in FILES:
        want = manifest["files"].get(name)
        if want != hashes[name]:
            print("HASH MISMATCH %s\n  manifest %s\n  on disk  %s" % (name, want, hashes[name]))
            bad += 1
    print("1. manifest: %d files, %d mismatches" % (len(FILES), bad))

    # 2. recount into a temp dir and compare expected files
    with tempfile.TemporaryDirectory() as td:
        for name in ("event.json", "commands.csv"):
            with open(os.path.join(fx, name), "rb") as src, open(os.path.join(td, name), "wb") as dst:
                dst.write(src.read())
        out = subprocess.run([sys.executable, "-I", os.path.join(tools, "reference_alloc.py"),
                              "--fixtures", td, "--write-expected"], capture_output=True, text=True)
        if out.returncode != 0:
            print(out.stdout, out.stderr)
            print("2. recount FAILED")
            sys.exit(1)
        diffs = 0
        for name in FILES[4:]:
            if sha(os.path.join(td, name)) != hashes[name]:
                print("RECOUNT DIFFERS %s" % name)
                diffs += 1
        print("2. recount: %d expected files, %d differ" % (len(FILES) - 4, diffs))
        bad += diffs

    # 3. answer key vs expected_commands
    exp = {}
    with open(os.path.join(fx, "expected_commands.csv"), newline="") as f:
        for r in csv.DictReader(f):
            exp[r["cmd_id"]] = r
    keyed = 0
    state_lines = 0
    for r in csv.DictReader(open(os.path.join(fx, "answer_key.csv"), newline="")):
        if r["cmd_id"].startswith("STATE@"):
            state_lines += 1
            continue
        keyed += 1
        got = exp.get(r["cmd_id"], {}).get("code")
        if got != r["expected"]:
            print("TRAP %s (%s): expected %s got %s" % (r["cmd_id"], r["trap"], r["expected"], got))
            bad += 1
    print("3. answer key: %d command traps agree, %d state assertions recorded" % (keyed, state_lines))

    # 4. coverage
    with open(os.path.join(fx, "expected_summary.json")) as f:
        summ = json.load(f)
    by_code = {}
    for r in exp.values():
        by_code[r["code"]] = by_code.get(r["code"], 0) + 1
    if by_code != summ["by_code"]:
        print("BY-CODE TABLE DIFFERS from expected_summary.json")
        bad += 1
    keyed_codes = {r["expected"] for r in csv.DictReader(open(os.path.join(fx, "answer_key.csv"), newline=""))
                   if not r["cmd_id"].startswith("STATE@")}
    rejects = {c for c, r in ((r["code"], r) for r in exp.values()) if r["status"] == "REJECT"}
    unkeyed = sorted(rejects - keyed_codes)
    print("4. reject codes exercised %d, keyed by a named trap %d%s" % (
        len(rejects), len(rejects & keyed_codes), ("; unkeyed: " + ", ".join(unkeyed)) if unkeyed else ""))

    if bad:
        print("FAILED (%d)" % bad)
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
