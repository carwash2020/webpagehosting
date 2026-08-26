# Docs

A wiki-style companion to the main `README.md` and `DISASTER_RECOVERY.md`
at the repo root -- built as real files in this repo (rather than
GitHub's Wiki feature) so they're fully version-controlled and
editable the same way as everything else here, no separate login or
UI needed.

- **[GLOSSARY.md](GLOSSARY.md)** -- quick definitions for terms used
  throughout this codebase that don't mean the obvious thing on first
  read (tombstone, graveyard, checkpoint tag, backfill, padded_range,
  and more).
- **[GETTING-STARTED.md](GETTING-STARTED.md)** -- for anyone (human or
  AI) opening this repo for the first time: what to read, in what
  order, and how to verify a change is actually safe before shipping
  it.

For the deep, authoritative detail on any specific system --
architecture, exact mechanisms, incident history, step-by-step
recovery -- the real answer almost always lives in `DISASTER_RECOVERY.md`
at the repo root, not here. This folder is for orientation; that file
is for depth.
