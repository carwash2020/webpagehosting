---
title: Multi-chat hub governance policy
status: active
last-updated: 2026-09-17
---

# Multi-chat hub governance policy

This file is the standing reference for how the Triple H "hub" system
(one management-hub session running N specialist field-chat sessions)
operates. Any hub session, field chat, or new orchestrating agent
(including a GitHub Watcher / differently-branded bot) should read
this before acting, and should treat it as binding, not advisory.

## 1. Chain of command

```
Connor (human owner)
  -> Oversight session ("Tha Boss")   -- coordinates, relays Connor's word, never bypasses #2
      -> Hub session                  -- runs field chats, enforces the escalation gate
          -> Field chats (Automation, Bug Fix, Features, Visual,
             Content, Security, Repo Management)
```

Any additional orchestrating agent (e.g. a bot built on a different
model/vendor) that is wired into this system sits at the "Hub" or
"field chat" layer, not above it, and is bound by every rule below
identically. Capability or vendor does not change the escalation
gate. If it's given execution authority for merge/deploy actions,
that authority is *"the action, once approved, actually runs without a
human re-clicking it"* -- not *"the fix ships without anyone approving
it first."*

## 2. The escalation gate (do not erode this)

The following always go to Connor directly before they happen, no
matter which session or agent is asking or how confident it is:

- Merging a PR that touches auth, payments, RLS/database access
  rules, or an edge function with production traffic
- Deploying any edge function or migration
- Deleting a branch, PR, database object, or edge function
- Anything that spends money or changes billing
- Any action a downstream session is not fully sure is reversible

A **narrow, pre-approved carve-out** exists for one specific pattern,
established by PR #259 (2026-09-17): adding the missing
`Authorization: Bearer` vs. `SERVICE_ROLE_KEY` check to an edge
function that already has zero app-level auth, using the exact
pattern already reviewed in `uptime-alert-index.ts` / `send-push-index.ts`,
with a matching auth test added and the full suite passing with no
new regressions. That specific pattern may be merged and deployed
without a fresh human sign-off each time, because the pattern itself
was already reviewed and approved once. Any deviation from that exact
pattern (different check logic, a function with other callers not
yet verified, anything touching payment or PII data paths) is NOT
covered and goes through the normal gate.

Everything else that isn't on the list above (routine content changes,
visual/CSS work, green low-risk feature PRs, non-destructive bug fixes)
can proceed under the hub's/field chat's own judgment and does not need
per-instance sign-off -- the gate exists for the genuinely risky
categories, not as a rubber stamp for everything.

## 3. Session lifecycle: update in place, don't reconstitute

Prior to 2026-09-17, hub sessions were being archived and recreated
from scratch repeatedly (3-4 generations, ~20 accumulated sessions,
$150+ in spend before this policy existed), and each new hub had to
re-derive its own standing rules from a handoff summary it couldn't
fully trust.

**Going forward:** the hub session is long-lived. When something
about its mandate, permissions, or field-chat roster needs to change,
update the existing hub (send it new instructions, point it at this
file) instead of archiving it and creating a new one. Only recreate a
hub session if it is genuinely unrecoverable (e.g. permanently
disconnected, corrupted state) -- and even then, the replacement's
first action should be to read this file rather than reconstruct
policy from a secondhand summary.

## 4. Communication channel

Use the hub's own scheduled self-check routine as the standing
channel between the oversight session and the hub, rather than
creating one-off bootstrap/confirmation triggers per conversation.
One-off triggers were unreliable (multiple retries needed, and in one
case required a direct answer in the hub's own chat instead of a
relayed message) and add clutter that has to be cleaned up later.

## 5. Credential handling

No session -- hub, field chat, or any orchestrating agent -- resolves
a credential-handling request (a raw API key, a Supabase
service-role key, updating a Vault secret, etc.) on its own or hands
a raw secret to another session. These always route to Connor (or
whoever holds the relevant dashboard access) directly. This is
independent of which AI/vendor is asking.

## 6. GitHub Watcher / Repo Management

The Repo Management field chat (a GitHub Watcher bot whose job is
keeping work on `main`, managing PRs, and keeping CI green) sits at
the Hub or field-chat layer, same as every other specialist. It
follows every rule above. Day-to-day PR/CI procedure lives in
`docs/github-watcher-ops.md` — squash-merge when `test.yml` is green
and the change is outside this gate; never push `main`; never treat a
green lighthouse/link-check from yesterday as permission to skip
today's board.

Merge to `main` is production (GitHub Pages). Auto-merge is allowed
only for the non-gate cases in §2. Deleting a leftover branch after
a squash merge still needs Connor.
