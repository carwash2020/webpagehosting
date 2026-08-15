#!/usr/bin/env python3
"""
Link checker for triplehenterprisesllc.biz.

Two passes, deliberately different in what they check:

1. INTERNAL links/assets (every *.html file in the repo) -- confirms
   every relative href/src actually resolves to a real file on disk.
   Pure static analysis, no network needed, so this also runs
   correctly against tool pages even though those require login to
   view in a real browser.

2. EXTERNAL links (public pages only -- index.html + the 5 landing
   pages, since those are what real visitors and Google actually
   crawl) -- a real HTTP request with a short timeout, reporting
   anything that doesn't come back 2xx/3xx. Internal tool pages are
   skipped here since they're not externally crawled and most of
   their external references are the same handful of CDN/font URLs
   already covered by the public pages.

Exits non-zero if anything is broken, so this fails visibly in CI
rather than passing silently.
"""
import os
import re
import sys
import urllib.request
import urllib.error

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_PAGES = [
    'index.html',
    'handyman-cedar-city-ut.html',
    'handyman-hurricane-ut.html',
    'handyman-mesquite-nv.html',
    'handyman-santa-clara-ivins-ut.html',
    'handyman-washington-city-ut.html',
]

HREF_SRC_RE = re.compile(r'(?:href|src)="([^"]+)"')
SCRIPT_BLOCK_RE = re.compile(r'<script\b[^>]*>.*?</script>', re.DOTALL | re.IGNORECASE)

# Not real broken-link candidates -- don't even attempt these.
SKIP_PREFIXES = ('mailto:', 'tel:', 'sms:', 'javascript:', '#', 'data:')


def find_html_files():
    files = []
    for root, dirs, names in os.walk(REPO_ROOT):
        if '.git' in root or 'node_modules' in root:
            continue
        for n in names:
            if n.endswith('.html'):
                files.append(os.path.relpath(os.path.join(root, n), REPO_ROOT))
    return sorted(files)


def check_internal_links():
    print("=== Internal links/assets ===")
    problems = []
    for html_file in find_html_files():
        path = os.path.join(REPO_ROOT, html_file)
        with open(path, encoding='utf-8') as f:
            content = f.read()
        # Strip <script> blocks entirely before scanning. Several pages
        # build href/src attributes dynamically at runtime inside
        # template literals or string concatenation (e.g.
        # `href="${signedUrls[...]}"` or `href="' + escapeHtml(url) +
        # '"`) -- those are JS code, not static HTML, and matching them
        # as literal file paths produces nonsense false positives.
        content_no_scripts = SCRIPT_BLOCK_RE.sub('', content)
        base_dir = os.path.dirname(path)
        for match in HREF_SRC_RE.finditer(content_no_scripts):
            link = match.group(1)
            if link.startswith(SKIP_PREFIXES) or link.startswith('http://') or link.startswith('https://'):
                continue
            if link.startswith('//'):
                continue
            # Strip query string / fragment before resolving to a file
            clean = link.split('?')[0].split('#')[0]
            if not clean:
                continue
            if clean.startswith('/'):
                target = os.path.join(REPO_ROOT, clean.lstrip('/'))
            else:
                target = os.path.join(base_dir, clean)
            if not os.path.exists(target):
                problems.append(f"{html_file}: broken reference '{link}' -> {os.path.relpath(target, REPO_ROOT)}")

    if problems:
        for p in problems:
            print(f"  BROKEN: {p}")
    else:
        print(f"  All internal references resolved across {len(find_html_files())} HTML files.")
    return problems


# Platforms that routinely 403/429 scripted requests even when the
# actual link is completely fine -- anti-bot measures, not a real
# problem. Logged as unverifiable rather than failing the whole check,
# so this doesn't cry wolf on every single run.
BOT_HOSTILE_DOMAINS = ('facebook.com', 'instagram.com', 'linkedin.com')


def check_external_links():
    print()
    print("=== External links (public pages only) ===")
    urls = set()
    for page in PUBLIC_PAGES:
        path = os.path.join(REPO_ROOT, page)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            content = f.read()
        for match in HREF_SRC_RE.finditer(content):
            link = match.group(1)
            if link.startswith('https://') or link.startswith('http://'):
                urls.add(link)

    problems = []
    unverifiable = []
    for url in sorted(urls):
        is_bot_hostile = any(d in url for d in BOT_HOSTILE_DOMAINS)
        try:
            req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0 (link-checker)'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.status
        except urllib.error.HTTPError as e:
            # Some sites (social platforms especially) reject HEAD but
            # are perfectly fine to GET -- retry before calling it broken.
            if e.code == 405:
                try:
                    req = urllib.request.Request(url, method='GET', headers={'User-Agent': 'Mozilla/5.0 (link-checker)'})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        status = resp.status
                except Exception as e2:
                    status = None
                    if is_bot_hostile:
                        unverifiable.append(f"{url} -> {e2} (known bot-hostile platform)")
                    else:
                        problems.append(f"{url} -> {e2}")
            elif e.code in (403, 429) and is_bot_hostile:
                status = None
                unverifiable.append(f"{url} -> HTTP {e.code} (known bot-hostile platform, not treated as broken)")
            else:
                status = e.code
                if status >= 400:
                    problems.append(f"{url} -> HTTP {status}")
        except Exception as e:
            problems.append(f"{url} -> {e}")
            status = None

        if status is not None:
            print(f"  {status}  {url}")

    if unverifiable:
        print()
        for u in unverifiable:
            print(f"  UNVERIFIABLE: {u}")
    if problems:
        print()
        for p in problems:
            print(f"  BROKEN: {p}")
    return problems


if __name__ == '__main__':
    internal_problems = check_internal_links()
    external_problems = check_external_links()
    total = len(internal_problems) + len(external_problems)
    print()
    if total:
        print(f"Link check FAILED -- {total} problem(s) found.")
        sys.exit(1)
    else:
        print("Link check passed -- everything resolved.")
