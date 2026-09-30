#!/usr/bin/env python3
"""Recursively downloads every real file in a Supabase Storage bucket
to a local directory, preserving the bucket's folder structure.

Written for backup-sensitive-data.yml (2026-08-27) after finding a
real bug during testing: Supabase Storage's list endpoint with
prefix="" only returns the TOP level of a bucket -- folders come back
as entries with id: None, not descended into automatically. Confirmed
directly against this project's real buckets (job-photos, receipts,
secure-documents) that every actual file lives at least one folder
deep (e.g. "business-formation/1785869142067_Certificate.pdf"), so a
flat, non-recursive list would have silently backed up zero files
every single day -- no error, just an empty result, which is exactly
the kind of failure that looks fine until the backup is actually
needed. Verified the recursive-descent logic below against a
realistic simulation of the actual bucket structure before ever
pointing it at a real bucket.

Second real bug, found 2026-09-07 running this for real against
secure-documents: a file literally named "Mobile Business License
Certificate.pdf" (spaces, no underscore-timestamp prefix like the
other files in that bucket) made download_file() build a download URL
with raw, unencoded spaces in it. Python's http.client rejects that
outright (InvalidURL: "can't contain control characters"), which
crashed the whole script -- not a partial/silent failure this time,
but it meant secure-documents (and anything after it in the bucket
loop) never got backed up at all on this run. Fixed by URL-encoding
just the path component with urllib.parse.quote(safe="/") (keeps the
real "/" separators as separators, encodes everything else, including
spaces) before building the download URL. The list endpoint's JSON
body doesn't need this -- only the raw URL construction did.

Usage:
    python3 backup-storage-bucket.py <bucket> <dest_dir>
    python3 backup-storage-bucket.py --all <dest_root>

--all (2026-09-30) backs up every bucket the project has, each into
<dest_root>/<bucket>, so a bucket added later is covered without an edit.
Listing pages through folders 1000 entries at a time (one list call
stops at 1000).

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as environment
variables. Exits non-zero (and prints a clear reason) on any failure,
rather than continuing partway and reporting success -- a partial,
silently-incomplete backup is worse than a loud, obvious failure that
gets noticed and re-run.
"""
import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse

LIST_PAGE = 1000


def list_all_files_recursive(base_url, headers, bucket, prefix=""):
    """Returns a flat list of every real file's full path in the bucket,
    descending into every subfolder. A folder entry has id: None; a
    real file entry does not."""
    list_url = f"{base_url}/storage/v1/object/list/{bucket}"
    # One list call returns at most LIST_PAGE entries, so a folder past
    # that (a busy job-photos month) would have been cut off with no
    # error. Page through until a short page (2026-09-30).
    entries, offset = [], 0
    while True:
        body = json.dumps({
            "prefix": prefix,
            "limit": LIST_PAGE,
            "offset": offset,
            "sortBy": {"column": "name", "order": "asc"},
        }).encode("utf-8")
        req = urllib.request.Request(list_url, data=body, headers={**headers, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                page = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            print(f"::error::Failed to list '{bucket}' at prefix '{prefix}': HTTP {e.code} -- {e.read().decode(errors='replace')}")
            sys.exit(1)
        entries.extend(page)
        if len(page) < LIST_PAGE:
            break
        offset += LIST_PAGE

    files = []
    for entry in entries:
        full_path = prefix + entry["name"]
        if entry.get("id") is not None:
            files.append(full_path)
        else:
            files.extend(list_all_files_recursive(base_url, headers, bucket, full_path + "/"))
    return files


def download_file(base_url, headers, bucket, path, dest_dir):
    download_url = f"{base_url}/storage/v1/object/{bucket}/{urllib.parse.quote(path, safe='/')}"
    dest_path = os.path.join(dest_dir, path)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    req = urllib.request.Request(download_url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        print(f"::error::Failed to download '{bucket}/{path}': HTTP {e.code}")
        sys.exit(1)
    with open(dest_path, "wb") as f:
        f.write(data)
    return len(data)


def list_buckets(base_url, headers):
    req = urllib.request.Request(f"{base_url}/storage/v1/bucket", headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            buckets = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"::error::Failed to list buckets: HTTP {e.code} -- {e.read().decode(errors='replace')}")
        sys.exit(1)
    return sorted(b["id"] for b in buckets)


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 backup-storage-bucket.py <bucket> <dest_dir>")
        print("       python3 backup-storage-bucket.py --all <dest_root>   (every bucket, into <dest_root>/<bucket>)")
        sys.exit(1)
    bucket, dest_dir = sys.argv[1], sys.argv[2]

    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        print("::error::SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.")
        sys.exit(1)

    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    # --all (2026-09-30): back up whatever buckets exist, so a new one
    # can't be missed the way new tables were.
    if bucket == "--all":
        buckets = list_buckets(base_url, headers)
        print(f"{len(buckets)} bucket(s): {', '.join(buckets)}")
        for name in buckets:
            backup_bucket(base_url, headers, name, os.path.join(dest_dir, name))
        return
    backup_bucket(base_url, headers, bucket, dest_dir)


def backup_bucket(base_url, headers, bucket, dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    print(f"Listing '{bucket}' recursively...")
    files = list_all_files_recursive(base_url, headers, bucket)
    print(f"{bucket}: {len(files)} real file(s) found")

    total_bytes = 0
    for path in files:
        size = download_file(base_url, headers, bucket, path, dest_dir)
        total_bytes += size
        print(f"  downloaded {path} ({size:,} bytes)")

    print(f"{bucket}: {len(files)} file(s), {total_bytes:,} bytes total")


if __name__ == "__main__":
    main()
