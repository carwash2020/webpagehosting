# Contributing

This is Triple H Enterprises' own private repo, not a project open to
outside pull requests -- so this file isn't the usual "how to submit
a PR to a public project" template. What it actually is: the real,
already-established workflow for making a change here safely, whether
that's Connor, Steve, or an AI assistant doing the work.

## Who actually touches this repo

Connor and Steve,
often working directly with an AI coding assistant rather than typing
every line by hand. If that's how a change gets made, the same
verification steps below still apply in full -- "an AI wrote it"
isn't a reason to skip testing, it's a reason to be more careful about
it, not less.

## Before making a change

Read `docs/GETTING-STARTED.md` first if this is a new area of the
codebase -- it lists the real reading order (`README.md` ->
`DISASTER_RECOVERY.md` -> `SECURITY.md` -> `docs/GLOSSARY.md`) and
explains what this repo actually hosts.

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

## Getting real review from the installed bots (added 2026-08-31)

Snyk, CodeRabbit, and Repowise are all installed on this repo, but
none of them add any value on a direct push to `main` -- they only
actually review a **pull request**. Every real change from here
forward should go through a PR rather than a direct push, specifically
so these tools get a genuine chance to weigh in before it merges.

- Repowise and Snyk trigger automatically on their own, no extra step.
- CodeRabbit does **not** run automatically on this repo -- confirmed
  directly in its own posted comment: it requires 10+ GitHub stars to
  review by default, and this repo doesn't have that many. Trigger it
  manually, every single PR, by checking the "Trigger review" box on
  its initial comment, or commenting `@coderabbitai review`.
- A failing check named "Code scanning AI findings on PR #N" (app:
  `github-actions`, a dynamic GitHub platform agent -- not anything
  in this repo's own workflow files, and not one of the three bots
  above) is a known, benign quirk specifically on documentation-only
  PRs with no real code changes. Confirmed directly, not assumed:
  zero actual code-scanning alerts exist when this happens. Not
  something to chase or try to fix.

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
