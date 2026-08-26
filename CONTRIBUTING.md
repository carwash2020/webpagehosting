# Contributing

This is Triple H Enterprises' own private repo, not a project open to
outside pull requests -- so this file isn't the usual "how to submit
a PR to a public project" template. What it actually is: the real,
already-established workflow for making a change here safely, whether
that's Connor, Steve, or an AI assistant doing the work.

## Who actually touches this repo

Connor (and Steve, for the parts of the business he's involved in),
often working directly with an AI coding assistant rather than typing
every line by hand. If that's how a change gets made, the same
verification steps below still apply in full -- "an AI wrote it"
isn't a reason to skip testing, it's a reason to be more careful about
it, not less.

## Before making a change

Read `docs/GETTING-STARTED.md` first if this is a new area of the
codebase -- it lists the real reading order (`README.md` ->
`DISASTER_RECOVERY.md` -> `SECURITY.md` -> `docs/GLOSSARY.md`) and
explains the two genuinely separate projects sharing this one repo
(Tagg-N-Go and Triple H Enterprises).

## Making the change

- Keep the two businesses' code and data separate, even though they
  share this repo and some genuinely shared files -- see "Shared
  files" in the main `README.md` for exactly what's shared and why.
- If you're touching a file more than one page loads (`sync.js`,
  `data-layer.js`, `styles.css`, etc.), that's a shared file --
  `npm run fix-versions` needs to run after, not just before you
  remember it.
- Deliver only what actually changed, not a full-repo re-push, unless
  a real structural reason requires one.

## Verifying it before it ships

This is the real, repeatable sequence used throughout this project's
history, not an aspirational ideal:

1. `npm test` -- the full suite, not just the specific test file for
   what you touched. A change can have a real ripple effect elsewhere
   that only running everything catches.
2. `npm run fix-versions` if any shared file changed.
3. `npm run check-consistency`, `npm run check-visual-snapshot`, and
   `python3 scripts/check-links.py`.
4. Push, then check the *real* GitHub Actions run for that exact
   commit -- a clean local run isn't the same thing as a confirmed
   green CI run, and this repo's own history has a real example of
   why that distinction matters (see `DISASTER_RECOVERY.md`).

## Writing tests for a new fix

Every test added to this project's suite is tied to a specific, real
behavior or bug -- not padding for its own sake. `tests/graveyard.test.js`
and `tests/tombstones-extended.test.js` are good recent examples of
the expected shape: test the underlying function directly, confirm
the actual call site really uses it (via source inspection for
anything async or modal-driven that isn't practical to simulate
end-to-end), and test the real failure scenario the fix closes, not
just the happy path.
