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

Usage:
    python3 backup-storage-bucket.py <bucket> <dest_dir>

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


def list_all_files_recursive(base_url, headers, bucket, prefix=""):
    """Returns a flat list of every real file's full path in the bucket,
    descending into every subfolder. A folder entry has id: None; a
    real file entry does not."""
    list_url = f"{base_url}/storage/v1/object/list/{bucket}"
    body = json.dumps({
        "prefix": prefix,
        "limit": 1000,
        "offset": 0,
        "sortBy": {"column": "name", "order": "asc"},
    }).encode("utf-8")
    req = urllib.request.Request(list_url, data=body, headers={**headers, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            entries = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"::error::Failed to list '{bucket}' at prefix '{prefix}': HTTP {e.code} -- {e.read().decode(errors='replace')}")
        sys.exit(1)

    files = []
    for entry in entries:
        full_path = prefix + entry["name"]
        if entry.get("id") is not None:
            files.append(full_path)
        else:
            files.extend(list_all_files_recursive(base_url, headers, bucket, full_path + "/"))
    return files


def download_file(base_url, headers, bucket, path, dest_dir):
    download_url = f"{base_url}/storage/v1/object/{bucket}/{path}"
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


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 backup-storage-bucket.py <bucket> <dest_dir>")
        sys.exit(1)
    bucket, dest_dir = sys.argv[1], sys.argv[2]

    base_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        print("::error::SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.")
        sys.exit(1)

    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

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
