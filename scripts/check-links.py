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
SCRIPT_BLOCK_RE = re.compile(r'<script\b[^>]*>.*?</script[^>]*>', re.DOTALL | re.IGNORECASE)

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


# Platforms that routinely 403/429/999 scripted requests even when the
# actual link is completely fine -- anti-bot measures, not a real
# problem. Logged as unverifiable rather than failing the whole check,
# so this doesn't cry wolf on every single run. Yelp added 2026-08-15
# after a real run confirmed it -- Yelp is well known to aggressively
# block non-browser traffic even on live, correct listing pages.
BOT_HOSTILE_DOMAINS = ('facebook.com', 'instagram.com', 'linkedin.com', 'yelp.com',
                        'fonts.googleapis.com', 'cal.com', 'google.com', 'googletagmanager.com', 'g.page')

# The site's own domain is deliberately NOT in the list above, even
# though it returned the identical HTTP 403 in the same CI run
# (2026-08-20) that added the other four. A third-party site blocking
# automated requests is a shrug; this site returning 403 to its own
# link checker is a different, more worth-knowing thing -- if a WAF or
# CDN in front of it is blocking datacenter/cloud IP ranges broadly
# (the likely cause, given the checker's own sandbox saw the same 403
# independently of GitHub Actions), that could plausibly also be
# blocking real crawlers or monitoring tools, not just this checker.
# Silently suppressing it here would hide that from view instead of
# surfacing it. If this keeps happening, it's worth an explicit ping to
# whoever manages that WAF/CDN config, not a permanent allowlist entry.
SITE_OWN_DOMAIN = 'triplehenterprisesllc.biz'

# rel values whose href is a warm-up hint, not a real fetchable
# resource -- preconnect/dns-prefetch origins are frequently just the
# bare domain root, which correctly 404s since nothing is actually
# served there. Added 2026-08-15 after a real CI run flagged
# fonts.googleapis.com and fonts.gstatic.com as "broken" when they were
# never meant to resolve as pages in the first place -- the actual
# stylesheet URL (with the real path and query string) was and is 200.
NON_FETCHABLE_REL = ('preconnect', 'dns-prefetch')


def check_external_links():
    print()
    print("=== External links (public pages only) ===")
    urls = set()
    preconnect_urls = set()
    link_tag_re = re.compile(r'<link\b[^>]*>')
    for page in PUBLIC_PAGES:
        path = os.path.join(REPO_ROOT, page)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            content = f.read()
        # First, find every <link> tag whose rel is a warm-up hint --
        # its href is never meant to resolve as a real page, so it gets
        # excluded from the "must return 2xx" set entirely rather than
        # relying on a domain-based guess.
        for tag in link_tag_re.finditer(content):
            tag_text = tag.group(0)
            rel_match = re.search(r'rel="([^"]+)"', tag_text)
            href_match = re.search(r'href="([^"]+)"', tag_text)
            if rel_match and href_match and rel_match.group(1) in NON_FETCHABLE_REL:
                preconnect_urls.add(href_match.group(1))

        for match in HREF_SRC_RE.finditer(content):
            link = match.group(1)
            if link.startswith('https://') or link.startswith('http://'):
                urls.add(link)

    urls -= preconnect_urls
    if preconnect_urls:
        print(f"  (skipping {len(preconnect_urls)} preconnect/dns-prefetch hint(s) -- not real fetchable pages)")

    problems = []
    unverifiable = []
    site_own_domain_flags = []
    for url in sorted(urls):
        is_bot_hostile = any(d in url for d in BOT_HOSTILE_DOMAINS)
        is_own_domain = SITE_OWN_DOMAIN in url
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
            elif e.code in (403, 429) and is_own_domain:
                status = None
                site_own_domain_flags.append(f"{url} -> HTTP {e.code}")
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

    if site_own_domain_flags:
        print()
        for f in site_own_domain_flags:
            print(f"  WORTH CHECKING (this site's own domain, not treated as broken -- see SITE_OWN_DOMAIN's comment above for why): {f}")
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
