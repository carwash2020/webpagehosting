# Action Items

A running list of things that can't be finished from code alone, plus a
running list of user-visible additions worth knowing about. Add to these
as new items come up.

## Manual action items (need a human, outside of code)

These cannot be done via a migration, edge function, or any MCP tool
available to this repo -- they require someone with dashboard access to
click a setting by hand.

1. **Enable "Prevent use of leaked passwords"** (Supabase dashboard:
   Authentication -> Providers -> Email -> "Prevent use of leaked
   passwords"). Protects both internal accounts and the growing
   client-portal population from credential-stuffing using passwords
   already exposed in public breaches. No UX change for anyone whose
   password isn't already compromised. See `SECURITY.md` "Known,
   accepted gaps" for full reasoning. **Not yet done.**
2. **Enable MFA availability** (Supabase dashboard: Authentication ->
   MFA). This only makes TOTP/phone factors available to enroll in --
   actual enrollment UI and a step-up-during-login challenge flow is a
   separate, larger feature decision, not a quick fix. Worth revisiting
   once the client-portal population is large enough that a single
   compromised password matters more. **Not yet done.**

<!-- Add new manual action items above this line -->

## Visual additions (things a real user/client will actually see)

User-facing UI/content changes made during the recent audit pass, for
reference:

- **Local reviews section** added to all 14 landing/about/work pages --
  real Google reviews, visible social proof above the fold area.
- **FAQ section** added to all 14 landing pages, with matching visible
  Q&A content (not just schema markup).
- **Privacy Policy page** (`privacy.html`) -- new, linked from footers
  site-wide.
- **Mobile hamburger menu** now closes on Escape / click-outside and
  returns focus properly across 16 pages (accessibility fix, subtle but
  user-facing).
- **Quote-to-invoice conversion rate** stat added to the invoice
  generator's Recent Quotes view (internal tool, Workspace users only).
- **Workspace "Getting Started" guide** rewording -- now explains the
  real per-account role system (Owner, Developer, Employee) instead of
  a stale "everyone shares one login" description.

<!-- Add new visual additions above this line -->
