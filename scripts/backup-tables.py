#!/usr/bin/env python3
"""Backs up every table named in scripts/backup-tables.json to
<dest_dir>/<table>.json, for backup-sensitive-data.yml (2026-09-30).

Replaces the workflow's inline curl loop, which had two silent gaps:

1. It fetched each table with one request. PostgREST returns at most
   1000 rows per request, so a table past 1000 rows (notification_log,
   portal_client_errors and site_terms_history all grow on their own)
   would have been cut off with no error. Tables are now read 1000 rows
   at a time, ordered by primary key, until a short page; the row count
   PostgREST reports up front is checked against what arrived.

2. Its table list was typed by hand, and new tables kept being missed:
   20 found in 2026-09-07's audit, 16 more by 2026-09-30 (including
   client_portal_contracts and client_portal_job_messages, flagged on
   2026-09-17). The script now reads the live table list from
   PostgREST's OpenAPI description and stops, before writing anything,
   if a live table isn't in backup-tables.json -- backed up, backed up
   elsewhere, or excluded with a reason. A config entry with no live
   table (renamed or dropped) stops it too.

Output format is unchanged: a JSON array of rows, written the way
`python3 -m json.tool` wrote it (4-space indent, ASCII-escaped).

Usage:
    python3 backup-tables.py <dest_dir>

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Exits non-zero with
a ::error:: line on any failure, never a partial success.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PAGE_SIZE = 1000
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup-tables.json")


def fail(message):
    print(f"::error::{message}")
    sys.exit(1)


def request(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        fail(f"HTTP {e.code} from {url.split('?')[0]} -- {e.read().decode(errors='replace')[:300]}")
    except urllib.error.URLError as e:
        fail(f"Could not reach {url.split('?')[0]} -- {e.reason}")


def live_tables(base_url, headers):
    """Table names PostgREST exposes, from its OpenAPI description
    (one path per table or view, plus /rpc/<fn> for functions)."""
    body, _ = request(f"{base_url}/rest/v1/", {**headers, "Accept": "application/openapi+json"})
    try:
        paths = json.loads(body)["paths"]
    except (ValueError, KeyError):
        fail("PostgREST's OpenAPI description had no 'paths' -- can't check the table list.")
    return sorted(p[1:] for p in paths if p != "/" and not p.startswith("/rpc/"))


def check_config(config, live):
    named = {}
    for group in ("tables", "public_elsewhere", "excluded"):
        for table in config.get(group, {}):
            if table in named:
                fail(f"{table} is listed twice in scripts/backup-tables.json ({named[table]} and {group}).")
            named[table] = group
    missing = [t for t in live if t not in named]
    if missing:
        fail("Not in scripts/backup-tables.json, so not backed up: " + ", ".join(missing)
             + ". Add each to 'tables' (back it up) or 'excluded' (with the reason).")
    gone = [t for t in named if t not in live]
    if gone:
        fail("In scripts/backup-tables.json but not in the live database: " + ", ".join(gone)
             + ". Remove or rename the entry.")


def total_from_content_range(value):
    # "0-999/1234", "*/0" or "0-4/5"; total is after the slash.
    m = re.match(r"^(?:\d+-\d+|\*)/(\d+)$", (value or "").strip())
    return int(m.group(1)) if m else None


def fetch_table(base_url, headers, table, order):
    rows, total, offset = [], None, 0
    while True:
        query = urllib.parse.urlencode({"select": "*", "order": order, "limit": PAGE_SIZE, "offset": offset})
        page_headers = {**headers, "Prefer": "count=exact"} if offset == 0 else headers
        body, resp_headers = request(f"{base_url}/rest/v1/{table}?{query}", page_headers)
        page = json.loads(body)
        if not isinstance(page, list):
            fail(f"{table}: expected a list of rows, got {type(page).__name__}")
        if offset == 0:
            total = total_from_content_range(resp_headers.get("Content-Range"))
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    if total is not None and len(rows) < total:
        fail(f"{table}: got {len(rows)} rows but the table reported {total}. Not writing a short copy.")
    return rows


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 backup-tables.py <dest_dir>")
        sys.exit(1)
    dest_dir = sys.argv[1]
    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not key:
        fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    with open(CONFIG_PATH, encoding="utf-8") as f:
        config = json.load(f)
    check_config(config, live_tables(base_url, headers))

    # Fetch everything first, then write, so a failure part-way leaves
    # yesterday's files untouched instead of a half-updated set.
    fetched = {}
    for table, order in config["tables"].items():
        fetched[table] = fetch_table(base_url, headers, table, order)
        print(f"{table}: {len(fetched[table])} row(s)")

    os.makedirs(dest_dir, exist_ok=True)
    for table, rows in fetched.items():
        with open(os.path.join(dest_dir, f"{table}.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(rows, indent=4) + "\n")
    print(f"{len(fetched)} table(s) written to {dest_dir}")


if __name__ == "__main__":
    main()
