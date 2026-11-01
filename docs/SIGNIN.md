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
- 2FA step with Trust this device for 30 days (skips the code on this device for 30 days; see below).
- Loading (spinner + label), wrong-password (red field, message, focus returns to the password), and a ~600ms success beat: the logo goes from 8% to full, the form settles, then the page redirects.
- `prefers-reduced-motion`: no transitions, no spinner spin, no shake; the success state flips instantly and redirects after a short beat.
- Brand orange `#F26B1D` on dark ink `#0B0A09`. Bricolage Grotesque (display) and Geist (body), self-hosted in `fonts/signin/` (OFL licences beside them). No Inter, no purple, no arrows on buttons.
- Fields 56px, buttons 58px, links and switches 48px or more. Visible 3px focus rings.

## Remember me, and Trust this device: what they actually do

Supabase has no per-login session lifetime, so both switches control **where the
session is stored** and a hard 30-day cutoff. Trust also registers this device
with the server so it can skip the code (below).

| Switch | ON | OFF |
|---|---|---|
| Remember me for 30 days | Session kept 30 days on this device (survives closing the browser) | Session ends when the browser closes |
| Trust this device for 30 days (2FA step) | The verified session is kept 30 days, **and this device skips the 2FA code for 30 days** (password still required) | The verified session ends when the browser closes; the next sign-in asks for the code |

- Trust starts from the Remember me setting and can be changed at the code step.
- **Trusted devices (2026-11-01).** With Trust on, after a correct code the page calls
  `trust_this_device()`. The server mints a random 256-bit token, stores only its bcrypt
  hash (same scheme as the Workspace recovery codes), and hands the token back once. The
  browser keeps `{ id, token, expires_at }` in localStorage (`th_trusted_device:<user id>`,
  `/trusted-device.js`). On the next sign-in, **after a correct password**, the page sends
  it to `use_trusted_device()`; only an explicit `true` skips the code. One mechanism for
  both pages: `sql/security/add_trusted_devices.sql`.
- What stops a device counting: 30 days pass; Remove in Settings; a password change (any
  path, including a reset email or the Supabase dashboard); 2FA turned off, reset or set up
  again; a Workspace recovery-code sign-in. These are checked on every use, server-side.
- Any device without a token, or one the server refuses, gets the code exactly as before.
  Leave Trust off on shared computers.
- Settings → **Trusted devices** (portal: Sign-in & security; Workspace: below Two-Factor
  Authentication) lists each device with Remove.
- Workspace: a trusted session is still `aal1` to Supabase. While `internal_mfa_mode` is
  `log` (live today) the server-side 2FA gate lets it through (and logs `would_block`). In
  `enforce` mode the gate refuses it and login.html asks for the code instead. Teaching the
  gate to accept trusted sessions replaces existing function bodies, so it is held in its
  own draft PR for separate review. Recovery codes and turning 2FA off still need the code.
- Employees: nothing is stored until the code, a recovery code, or a server-accepted trusted
  device clears. Accounts that require 2FA and have none are still forced to enrol.

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
