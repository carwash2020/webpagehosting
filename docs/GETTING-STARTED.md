# Getting started

For anyone -- human or AI -- opening this repo for the first time and
needing to actually get oriented, not just skim.

## Read these, in this order

1. **`README.md`** (repo root) -- file structure, what's shared vs.
   tool-only, the sync architecture, the booking system, deployment.
   Start here regardless of what you're about to work on.
2. **`DISASTER_RECOVERY.md`** (repo root) -- the deep detail behind
   almost everything mentioned in the README: exact mechanisms, real
   incidents and how they were actually found and fixed, step-by-step
   recovery procedures. Read the specific section relevant to what
   you're touching *before* changing it, not after something breaks.
3. **`SECURITY.md`** (repo root) -- the actual current security model
   and why it's shaped the way it is, before touching anything RLS-,
   auth-, or function-privilege-related.
4. **`docs/GLOSSARY.md`** -- if a term in any of the above doesn't
   make sense on first read, check here before assuming it means the
   obvious thing.

## Two separate projects, two separate Supabase backends

This repo hosts **two genuinely separate things** from one GitHub
Pages deployment: Tagg-N-Go's public car wash site and internal
incident tools, and Triple H Enterprises' public site and internal
tool suite. They share this repo and some genuinely shared files
(see "Shared files" in the README), but their data, Supabase
projects, and business logic never cross. Know which one you're
actually working on before you start -- the file structure sections in
the README tell you which files belong to which.

## Before shipping any change

This isn't a formal CI gate for every single file (a typo fix to a
sentence doesn't need this), but for anything touching shared
JS/CSS, sync behavior, or test-covered logic, this is the real,
repeatable sequence used throughout this project's history:

1. **Run the full test suite:** `npm test`. Don't stop at the new
   test you just added passing -- run everything, since a change can
   have a real ripple effect elsewhere (this has happened for real:
   adding a new Dev Tools panel correctly bumped a hardcoded
   panel-count test from 26 to 27, which only showed up by running
   the full suite, not the new file in isolation).
2. **If you touched a shared file** (anything referenced by more than
   one page -- `sync.js`, `data-layer.js`, `styles.css`, etc.), run
   `npm run fix-versions`. This recalculates the content-hash cache-
   busting suffix and updates every page that references the changed
   file. Skipping this means some pages could keep serving a stale
   cached copy after deploy.
3. **Run `npm run check-consistency`, `npm run check-visual-snapshot`,
   and `python3 scripts/check-links.py`.** All three are fast and
   catch different things: shared-file version mismatches, unintended
   visual/DOM changes, and broken links.
4. **Push, then actually check real CI** -- don't assume a clean local
   run means the real GitHub Actions run will also be clean. Query the
   Actions API or check the Actions tab directly and confirm the
   specific commit's run completed with `conclusion: success`.

## If something looks broken in production

Check `DISASTER_RECOVERY.md` first -- there's a real, growing history
of incidents in there (a stale-cache bug that shipped a broken script
reference, a GitHub Actions platform outage, deletion resurrection
from a sync-merge edge case) each with the actual root cause and fix,
not just a generic troubleshooting checklist. The specific symptom
you're seeing has likely already happened once and is already
documented.
