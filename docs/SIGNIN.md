# Sign-in screens (client portal and employee tools)

Rebuilt 2026-10-31. Two pages share one look:

| Page | Who | 2FA |
|---|---|---|
| `portal/login.html` | Clients | Optional (client turns it on in Settings) |
| `tools/login.html` | Employees | Mandatory for any account whose permissions require it (`requiresMfaForRole()` in `tools/auth.js`) |

Both still use Supabase **email + password**. Nothing here is passwordless, and
no auth call, id, or redirect changed. The rebuild is the shared stylesheet
(`signin.css`), a small helper (`signin-ui.js`), and the page markup.

## What's on the screen

- The existing site logo (`images/logo-signature-orange.webp`), large, at 8% opacity behind the form. It is decorative (`alt=""`, `aria-hidden`).
- Email, password with Show/Hide, Forgot password, Remember me for 30 days.
- 2FA step with Trust this device for 30 days.
- Loading (spinner + label), wrong-password (red field, message, focus returns to the password), and a ~600ms success beat: the logo goes from 8% to full, the form settles, then the page redirects.
- `prefers-reduced-motion`: no transitions, no spinner spin, no shake; the success state flips instantly and redirects after a short beat.
- Brand orange `#F26B1D` on dark ink `#0B0A09`. Bricolage Grotesque (display) and Geist (body), self-hosted in `fonts/signin/` (OFL licences beside them). No Inter, no purple, no arrows on buttons.
- Fields 56px, buttons 58px, links and switches 48px or more. Visible 3px focus rings.

## Remember me, and Trust this device: what they actually do

Supabase has no per-login session lifetime, so both switches control **where the
session is stored** and a hard 30-day cutoff, not whether the server checks
anything.

| Switch | ON | OFF |
|---|---|---|
| Remember me for 30 days | Session kept 30 days on this device (survives closing the browser) | Session ends when the browser closes |
| Trust this device for 30 days (2FA step) | The 2FA-verified session is kept 30 days on this device, so no code on each visit | The verified session ends when the browser closes |

- Trust starts from the Remember me setting and can be changed at the code step. The choice made at the code step decides how the verified session is stored.
- **Trust never skips the code.** There is no client-side "trusted device" flag. Every password sign-in on an account with a verified factor still goes to the code step. Trust only decides how long the already-verified session lives. Leave it off on shared computers.
- Employees: nothing is stored until the code (or a recovery code) is verified. Accounts that require 2FA and have none are still forced to enrol before anything is stored.

### Portal storage rules (`portalAuthStorage()` in `portal/portal-app.js`)

Every portal page builds its Supabase client with this storage, so the choice
holds across pages:

- ON: `localStorage` plus `th_portal_remember_until` (now + 30 days). Checked on every read; past the cutoff the session is purged.
- OFF: `sessionStorage` (marker `th_portal_session_only`); new tabs and restarts start signed out.
- A session from before this change (in `localStorage`, no cutoff record) keeps working with no cap, exactly as before.

Tools keep their existing store in `tools/auth.js` (`th_auth_session`, `remember_until`).

## Verifying

```bash
npm test                      # includes tests/portal/signin-rebuild.test.js
npm run verify                # everything CI runs
```

Real-browser check (needs Playwright, which is deliberately not a repo
dependency; Supabase is mocked, so no real account is touched):

```bash
SUPABASE_UMD=/path/to/supabase.js AXE_JS=/path/to/axe.min.js \
  node scripts/signin-browser-check.js            # assertions only
SUPABASE_UMD=... AXE_JS=... node scripts/signin-browser-check.js --screenshots
```

It asserts Remember me across a simulated browser restart and past the 30-day
cutoff, Trust on and off, wrong password, wrong code, the 600ms beat, reduced
motion, fonts, tap sizes, and runs axe (WCAG 2.2 A/AA) on every state.
`--screenshots` rewrites `docs/screenshots/signin/` (every state, 390x844 and
1440 wide; `p` = portal, `t` = tools).
