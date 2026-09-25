# Action Items

A running list of things that can't be finished from code alone, plus a
running list of user-visible additions worth knowing about. Add to these
as new items come up.

## Reserved images (supplied, not yet placed)

Real photos the owner supplied directly during the 2026-09-16 blog-image
pass, not used yet because nothing on the site is the right fit for them.
Kept here so they don't get lost -- pull from this list before reaching
for stock photos next time something needs a real kitchen or laundry
image.

1. ~~**Stacked washer/dryer in a modern bathroom laundry nook** (dark
   vanity, towels, plant) --
   `https://images.unsplash.com/photo-1721395285456-05a8b9b45b9f?fm=jpg&q=80&w=1400&auto=format&fit=crop`.~~
   **Placed (2026-09-25)** as the lead image on
   `blog/washer-leaking-water.html`. Nothing else is reserved right now.

<!-- Add new reserved images above this line -->

## Manual action items (need a human, outside of code)

These cannot be done via a migration, edge function, or any MCP tool
available to this repo -- they require someone with dashboard access to
click a setting by hand.

1. ~~Enable "Prevent use of leaked passwords" (Supabase dashboard:
   Authentication -> Providers -> Email -> "Prevent use of leaked
   passwords").~~ **Done (2026-09-15).**
2. ~~Enable MFA availability~~ -- **done.** TOTP enabled in the
   Supabase dashboard (Authentication -> MFA), and the enrollment UI
   plus login-time step-up challenge this item originally flagged as
   "a separate, larger feature decision" were built (2026-09-16): a
   "Two-Factor Authentication" card in `portal/settings.html` (enroll
   with a real QR code, verify, or turn off -- via
   `client.auth.mfa.enroll/challengeAndVerify/unenroll`), and
   `portal/login.html` now checks
   `client.auth.mfa.getAuthenticatorAssuranceLevel()` after a correct
   password and prompts for a 6-digit code before finishing sign-in
   when a client has a verified TOTP factor. Client-portal only, by
   design -- opt-in, not required: an account with no factor enrolled
   signs in exactly as before.
   ~~Doesn't touch the internal `/tools/` suite's own
   Owner/Developer/Employee auth (a separate, unrelated concern; see
   `docs/CLIENT-PORTAL.md`'s "Still pending" item 3 for that one).~~ --
   **that gap is closed too now (2026-09-22).** Internal accounts get
   the same real TOTP MFA (raw `fetch()` against the Supabase Auth
   REST endpoints in `tools/auth.js`, not the SDK the portal loads),
   with a real chokepoint at `tools/login.html` (a session is never
   persisted until MFA, or a recovery code, clears -- see
   `tools/auth.js`'s `signIn(..., {skipPersist:true})`), a
   Settings-based self-serve enroll/disable card, and a custom
   recovery-code system (`sql/security/add_internal_mfa_recovery_codes.sql`)
   since Supabase's own native recovery-codes API is behind an
   unconfirmed experimental flag on this project. Mandatory for any
   account whose real permissions require it, optional-but-encouraged
   otherwise. Full reasoning: `docs/specialist-logs/security.md`'s
   2026-09-22 entry.
3. **Set up a Google Ads or Meta Pixel account** for retargeting. GA4
   events are already firing (`lead_form_submitted`, `phone_click`,
   `book_cta_click`, `booking_page_view`, `booking_form_start`,
   `booking_completed`, `email_click`, etc.) and ready to feed a
   remarketing audience the moment one exists -- give me the conversion
   ID (`AW-...`) or Pixel ID once you have an account and I'll wire up
   the actual tag/base code. **Not yet done (no account exists to wire
   up).** Optional GA4 dashboard step: mark `booking_completed` and
   `lead_form_submitted` as conversions, and use DebugView to confirm
   the new events after merge.
4. ~~Claim/verify Google Business Profile~~ -- **confirmed done
   (2026-09-16): "Triple H Enterprises LLC", verified badge, category
   already "Appliance repair service", 5.0 stars / 7 Google reviews
   (as of the latest screenshot), phone matches.** Still open: paste
   in the longer description,
   individually-listed services, and the 3 seed Q&As drafted under "SEO
   copy drafts" below -- profile exists and is verified, but that
   content doesn't look filled in yet from the screenshot. **Ongoing
   after that:** regular posts, fresh job photos, and prompt review
   responses keep moving the local 3-pack ranking -- not a one-time
   task.
5. **Google Local Services Ads ("Google Guaranteed")** -- pay-per-lead,
   usually the best ROI channel for handyman/appliance repair
   specifically. Requires setting up and getting verified/background-
   checked through Google's own LSA program, outside this repo.
6. **Review count mismatch: the site showed 7 reviews, Google showed
   6.** Checked directly against the real Google listing via
   screenshots the owner sent: only 3 of the original 7 quotes matched
   a real, verifiable Google review (Google had 6 total reviews, but 2
   of them -- Austin Mayer, Micah Naegle -- are star-only with no
   written text). The other 4 site quotes couldn't be traced to any
   real source, so they were removed rather than kept unverified or
   rewritten to fit a real reviewer's name. Jilleen Walker's real
   review (never on the site before) was added in as a genuine 4th
   card. The homepage wall still shows those 4 written quotes only.

   ~~**Update (2026-09-16):** Google had 7 reviews; the 7th had no
   written text, so schema stayed at 4 (visible quotes, not Google's
   raw total).~~

   **Update (2026-09-17, owner unlock):** GBP currently shows **5.0
   stars from 7 Google reviews**. Connor unlocked matching that total.
   `aggregateRating` is now ratingValue 5.0 / reviewCount 7, and
   on-page copy ("5.0 from 7 Google reviews", "Real 5-Star Reviews"
   stat) matches. No invented Review objects or fake cards for the
   star-only reviews. **Done.** If a future review has real written
   text, send it over and it can be added as a genuine extra wall
   card.
7. ~~Deploy the new `send-payment-reminder` edge function and run its
   cron SQL~~ -- **deploy itself done** (function live at version 5,
   `send-payment-reminders-daily` cron active, 15:00 UTC daily). **But
   verified broken (2026-09-16, checked directly)**: every real
   cron-triggered run 401s and sends nothing -- the cron's vault secret
   doesn't match what the function's own strict auth check requires.
   Not a "needs deploy access" item anymore; now a "needs the real
   `service_role` key from the Supabase dashboard" item -- see
   `docs/specialist-logs/bugfix.md`'s 2026-09-16 entry for the full
   root cause and what to do with the key once it's in hand.
8. ~~Deploy the new `send-quote-followup` edge function and run its
   cron SQL~~ -- **same story as #7, same real cause, same fix
   needed.** Function live (version 2), `send-quote-followup-daily`
   cron active at 16:00 UTC, also 401ing on every real run. `send-push`
   itself (the "Review Follow-Up Due" check) is unaffected -- that one
   has no exact-match auth check and has been firing fine hourly on the
   same vault secret; only these two newer functions added the
   stricter check and are the ones actually blocked by it.
9. **Resolved (confirmed 2026-09-23).** Both strict-check crons
   (`send-payment-reminder` 15:00 UTC, `send-quote-followup` 16:00 UTC)
   returned 200 on their 2026-09-22 runs (`function_edge_logs`), so the
   Vault secret now matches the functions' service-role key and items 7
   and 8 are working. Original item, for the record:
   **Get the real `service_role` key from Supabase (Project Settings ->
   API) and update the `send_push_service_role_key` vault secret** (or
   create a new dedicated one and repoint the two crons above) --
   the one manual step actually blocking items 7 and 8 from working.
   Everything else about both is done and tested.
10. **Resolved (confirmed 2026-09-23):** `list_edge_functions` no longer
    shows a lowercase `send-push`; only `Send-Push` is deployed. Original
    item, for the record:
    **Delete the orphaned lowercase `send-push` Edge Function** (id
    `aaa21126-3451-4bd2-a8e3-97d4f95bbf5a`, slug `send-push`, v8) --
    re-confirmed live and still deployed (2026-09-16), contradicting an
    earlier README note that it was already gone. It's a genuinely dead,
    stale duplicate of the real `Send-Push` function: its source is
    missing 3 real fixes the live `Send-Push` (v50) has since picked up
    (the business-timezone fix, the partial-payment-aware overdue check,
    `checkPendingReviewReminders`), and nothing calls it -- verified both
    by grepping the whole repo (every call site uses exact-cased
    `Send-Push`, enforced by 4 test files) and by querying the live
    database directly (`cron.job` and every `pg_proc` function body) for
    any lowercase `/send-push` URL -- zero matches either way. **Needs a
    human with the Supabase dashboard or CLI**: the Supabase MCP tools
    available in this environment can list/read/deploy Edge Functions but
    have no delete call, and the `supabase` CLI isn't installed in this
    environment either. Delete via Supabase dashboard → Edge Functions →
    `send-push` → Delete, or `supabase functions delete send-push` from a
    machine that has the CLI and project access.

11. **Turn off public signup in Supabase Auth** (dashboard:
    Authentication -> Sign In / Providers -> "Allow new users to sign
    up" -> off). Confirmed live 2026-09-23 that it's on
    (`disable_signup: false`), which lets any stranger with a mailbox
    hold an `authenticated` session -- the root cause of that day's
    CRITICAL finding (`docs/specialist-logs/security.md`). Nothing in the
    repo calls `signUp`; portal invites (`send-invite`, service role)
    keep working with signup off.
12. **Resolved (2026-09-23).** Every security-fixed edge function merged
    that day is deployed from `main` and verified live (anon -> 401, the
    triggers' Vault key -> through). Results per function:
    `docs/specialist-logs/security.md`, "round 3 follow-up".
13. **Decide on server-side MFA enforcement for internal accounts**
    (2026-09-23 audit, finding #4, HIGH). Two-factor is only checked by
    `tools/login.html`. Nothing on the server looks at the session's
    `aal` level, so someone with a stolen password can skip the login
    page, call the Auth and REST APIs directly, and reach every internal
    table and edge function. They can also call
    `generate_internal_recovery_codes()` on that password-only session
    to mint fresh recovery codes.
    - **The fix:** `current_user_has_any_role()` and the internal edge
      functions require `aal2` whenever the account has a verified
      factor. Generating recovery codes requires `aal2` too. The
      recovery-code login path has to keep working, or a lost phone
      locks the owner out.
    - **Why it waits for you:** a mistake here can lock Steve and Connor
      out of the tools. Say "go" in a new chat and point it at
      `docs/specialist-logs/security.md` (the 2026-09-23 "round 3" entry
      and its "follow-up"). It should build this behind a careful
      rollout: dry-run, test both accounts, keep a way back in.

14. **Confirm who should see the team's hours** (shift clock, 2026-09-23).
    The Dashboard's Hours worked card shows everyone's shifts only to
    accounts with the finance permission (Owner and Developer by
    default); everyone else sees only their own. Change it per account
    in Dev Tools -> Account permissions (the finance checkbox). If Steve
    wants someone to see hours without seeing finance, that needs its
    own permission (a new `account_roles` column), which is a small
    follow-up. The hours are an attendance record, not pay: the business
    still pays per job.

15. **Decide who can save a card from portal Settings** (2026-09-23
    audit, finding #6, MEDIUM). `manage-saved-card`'s
    `create_setup_intent` mode accepts any signed-in account. With
    public signup on (#11), a stranger can sign up and use it to create
    Stripe Customers and SetupIntents, a common way to test stolen cards.
    - **Quickest fix:** turning signup off (#11) removes the stranger case.
    - **The code fix needs a product call:** who counts as a real client?
      "Has an invoice, quote, job, contract or checkup" would block a
      client whose only item is a work order they submitted themselves.
      `client_account_codes` can't be the marker, because it's empty for
      every current client account.
    - **Next step:** once you decide, ask a new chat to gate
      `edge-functions/manage-saved-card-index.ts` on that rule, and
      deploy it.
16. ~~**Webhook doesn't compare the amount paid to the invoice total**
    (2026-09-23 audit, finding #7, LOW).~~ **Fixed in code (2026-09-25).**
    `stripe-webhook` now compares `amount_received` to what the
    invoice(s) still owe. Paid short: left unpaid, and staff get an
    "Invoice paid short" push. Overpaid: marked paid, and staff get an
    "Invoice overpaid" push. Chosen over cancelling the superseded
    PaymentIntent, because a page opened before the raise can pay the
    invoice's only PaymentIntent, and then there's nothing to cancel.
    - **Still needs:** deploying `stripe-webhook` from `main`, with
      `verify_jwt` **off** exactly as now (Stripe can't send a Supabase
      JWT, so turning it on would stop every invoice being marked paid).
    - **That deploy ships more than this fix.** Live v18 is the
      2026-09-14 code. `main` also carries PRs #213 and #217
      (2026-09-15), never deployed: a failed "mark paid" write now
      returns 500 so Stripe retries it, `workspace_sync` failures are
      logged, and POS income is dated in Denver time instead of UTC.
17. ~~**`work-order-photos` storage bucket accepts any upload** (2026-09-23
    audit, LOW). Its INSERT policy checks only `bucket_id`, so any
    signed-in account can upload files there. It's spam and storage
    cost only: there's no read-back and no overwrite.~~ **Done
    (2026-09-25), applied live.**
    - The page uploads before the work order exists, so there's no
      work-order id to scope to. Uploads are scoped to the uploader's
      account instead: `submissions/<auth.uid()>/<folder>/<n>.<ext>`.
      The policy rejects any other path, including other accounts'
      folders.
    - The bucket also takes images only, 8 MB max (the page's own
      limits).
    - **Still open:** any signed-in account can still fill its own
      folder. Turning signup off (#11) removes strangers from that.

<!-- Add new manual action items above this line -->

## SEO action items (need a human, outside of code)

Real, ranked things that grow organic traffic/leads but genuinely can't
be done from a repo -- they need a login, a phone call, or a person on
the other end. Code-side SEO work (schema, page speed, content structure)
lives in "Proposed visual improvements" below and gets built directly
when greenlit; these do not.

1. **Google Business Profile: claim/verify it if not already, and keep
   it active.** This is usually the single biggest local-ranking lever
   for a service business -- more than anything on the site itself.
   Weekly: add a photo from a real job, post an update, answer any new
   Q&A. Respond to every review (good or bad) within a few days.
2. **Ask every real happy customer for a Google review, not just a
   Triple H internal one.** The site's review-request tool
   (`tools/review-request.html`) sends a text/email asking for feedback,
   but getting it to actually land as a public Google review (not just a
   private reply) is a manual nudge -- "if you have 30 seconds, a Google
   review helps other people in town find us" -- worth saying out loud on
   the last visit of a job, not just texting a link.
3. **Real backlinks from other real local sites**: BBB, the St. George
   Area Chamber of Commerce, Nextdoor Business, Angi/HomeAdvisor/Thumbtack
   profiles, local supplier sites that list contractors they work with.
   None of this can be automated -- each is its own signup/profile/claim
   process, and a link from a real local business directory carries much
   more SEO weight than anything on-site.
4. ~~**NAP consistency check**~~ **Done (2026-09-16).** Checked against
   the site's own canonical NAP (Triple H Enterprises LLC, (435)
   414-1667, steve@triplehenterprisesllc.biz, St. George, UT 84790):
   Yelp matches, Facebook matches. No BBB listing (costs money --
   skipped on purpose, not an oversight; still worth revisiting under
   "real backlinks" above once there's budget for it, since a BBB
   listing is both a NAP-consistent citation and a real backlink).
   **Found a real mismatch on Google Business Profile**: an old
   business-card-style photo on the listing showed a stale phone number
   (801-357-9940) and email (triplehenterprises88@gmail.com). Two
   updated photos (a current-logo profile photo and a corrected
   business-card cover photo with the real phone/email) were generated
   and handed off to replace it -- **still needs the actual "Edit
   profile" phone/website fields on the GBP listing itself checked
   too**, not just the photo, since that's the field Google's ranking
   algorithm actually reads.
5. **Google Search Console**: verify site ownership (a one-time
   dashboard/DNS step, can't be done from this repo) if not already
   done, then check it periodically for crawl errors, manual actions, or
   pages Google isn't indexing that should be.
6. **More non-flooring job photos**, handed off for the site to use --
   already flagged under "Proposed visual improvements" below (#1), but
   worth calling out here too: real photos are also a genuine SEO input
   (image search, GBP posts, city-page credibility), not just visual
   polish.
7. **Local sponsorships/community involvement** (a little league team, a
   school fundraiser, a chamber event) that naturally generates a real
   backlink or local news mention -- slower, but the kind of link no
   amount of code can manufacture.

8. **Request indexing for the three new blog posts** (2026-09-25) in
   Google Search Console (URL Inspection, then "Request indexing"):
   `/blog/washer-leaking-water.html`, `/blog/dryer-wont-turn-on.html`,
   `/blog/dishwasher-not-draining.html`. They're in `sitemap.xml`
   already, so Google will find them anyway. Requesting indexing is
   just faster.

<!-- Add new SEO action items above this line -->

## SEO copy drafts (ready to paste in, 2026-09-16)

Drafted so items 1 and 3 above are copy/paste instead of blank-page work.
**NAP audited against the site first** (index.html, `LocalBusiness` schema)
and confirmed consistent -- use exactly this everywhere a listing asks for
name/address/phone, so nothing has to be fixed later:

- **Name:** Triple H Enterprises (LLC)
- **Phone:** (435) 414-1667
- **Email:** steve@triplehenterprisesllc.biz
- **Address:** St. George, UT 84790 (service-area business, no public
  storefront -- on Google Business Profile, set this up as a "service
  area business" and hide the address, which is the correct setting for
  an owner-operator who drives to jobs rather than a shop customers visit)
- **Website:** https://www.triplehenterprisesllc.biz/
- **Service area:** St. George, Hurricane, Washington City, Santa Clara,
  Ivins, La Verkin, Leeds, Cedar City, Mesquite NV

### Google Business Profile

- **Primary category:** Appliance repair service
- **Additional categories:** Handyman, Contractor
- **Short description (750 char limit):**
  > Owner-operated handyman and appliance repair serving St. George and
  > Southern Utah. Washers, dryers, dishwashers, fridges, ranges, general
  > handyman repairs, plumbing fixes, drywall and painting, assembly and
  > installation, and emergency calls. When you call, you're talking
  > directly to the owner -- not a call center or rotating
  > subcontractors. Same-day service available. Serving St. George,
  > Hurricane, Washington City, Santa Clara, Ivins, La Verkin, Leeds,
  > Cedar City, and Mesquite NV. Call or text (435) 414-1667.
- **Services to list individually** (GBP lets you add each as its own
  service under the category, which helps it match more specific
  searches): Washer repair, Dryer repair, Dishwasher repair,
  Refrigerator repair, Range/oven repair, General handyman repair,
  Plumbing repair, Drywall repair, Interior painting, Furniture
  assembly, TV mounting, Emergency repair
- **Seed Q&A** (post these yourself as the owner, so they show up
  answered from day one instead of sitting empty for a stranger to ask):
  - Q: "Do you charge a trip fee?" A: (use each city page's actual
    trip-fee wording, already live on the site -- keep it consistent)
  - Q: "Do you offer same-day service?" A: "Yes, when the schedule
    allows -- call or text (435) 414-1667 to check same-day
    availability."
  - Q: "What brands of washers/dryers do you repair?" A: "All major
    brands -- Whirlpool, Maytag, LG, Samsung, GE, and more."
- **Weekly cadence:** one photo from a real job, one GBP post/update,
  answer new Q&A and reviews within a few days (see item 1 above).

### Directory listings (BBB, Angi, Thumbtack, Yelp, Nextdoor, Yellow Pages)

Use the same description on every one so the business reads as one
consistent entity across the web, not five slightly different ones:

> Triple H Enterprises is an owner-operated handyman and appliance
> repair business based in St. George, Utah. We repair washers, dryers,
> dishwashers, refrigerators, and ranges, plus general handyman work:
> plumbing fixes, drywall and painting, furniture assembly, and TV
> mounting. Emergency calls welcome. Serving St. George, Hurricane,
> Washington City, Santa Clara, Ivins, La Verkin, Leeds, Cedar City, and
> Mesquite, NV. Call or text (435) 414-1667.

- **Categories to select where the site offers a picklist:** Appliance
  Repair, Handyman Services, General Contractor (if offered, otherwise
  skip)
- **Website field:** always the full `https://www.triplehenterprisesllc.biz/`
  URL, not a bare domain or a page deep-link, so backlink value goes to
  the homepage.
- Yelp and Nextdoor in particular reward profile completeness (hours,
  photos, service list) for initial visibility, so fill in every field
  the form offers rather than the minimum required.
- **Angi, HomeAdvisor, and Thumbtack are lead-generation marketplaces,
  not free citations like Yelp/Nextdoor/BBB** -- a free basic profile
  is usually possible (still worth the backlink/citation value even
  unpaid), but ranking within their own search and getting routed real
  leads typically requires a paid membership or per-lead fee. Worth
  doing the free profile everywhere either way; treat the paid tier on
  any of these as a separate cost/ROI decision, not part of this
  backlink pass.

### St. George Area Chamber of Commerce

Chamber directories usually want a slightly more community-facing tone
than a repair-marketplace listing, and often ask for a member
"spotlight" or "about us" blurb separate from the plain business
description above:

> Triple H Enterprises is a locally owned, owner-operated handyman and
> appliance repair business serving St. George and the surrounding
> Southern Utah communities -- Hurricane, Washington City, Santa Clara,
> Ivins, La Verkin, Leeds, Cedar City, and Mesquite, NV. We handle
> everything from washer/dryer and appliance repair to plumbing fixes,
> drywall and painting, furniture assembly, and general handyman work,
> with the owner answering the phone directly on every call. Honesty,
> hustle, and helpfulness aren't just a slogan -- they're how we run
> every job. Call or text (435) 414-1667.

- Chamber membership itself is usually a paid annual fee (unlike the
  free-tier directories above) -- confirm current pricing with the
  Chamber directly before joining; the payoff here isn't just the
  directory backlink, it's the local-sponsorship/event angle in item 7
  above (a Chamber event or mixer is a natural, real way to pick up
  that kind of link/mention, not something code can manufacture).
- If the Chamber's own directory offers a logo/photo upload, use the
  same current orange logo (`images/logo-signature-orange.webp`) and
  the GBP business-card photo generated earlier this session, so the
  brand looks consistent everywhere it shows up.

### Yelp profile refinement (2026-09-16)

NAP already confirmed matching (see "NAP consistency check" above) --
this is about filling in the fields that actually move Yelp's own
search ranking and conversion, past the bare minimum:

- **"From the Business" long description** (Yelp allows up to ~1,000
  characters here, separate from the shorter summary blurb above):
  > Triple H Enterprises is a locally owned, owner-operated handyman
  > and appliance repair business based in St. George, Utah. When you
  > call, you're talking directly to the owner, Steve -- not a call
  > center or a rotating cast of subcontractors. We repair washers,
  > dryers, dishwashers, refrigerators, and ranges, and handle general
  > handyman work: plumbing fixes, drywall and painting, furniture
  > assembly, and TV mounting. Jobs within 15 miles of St. George have
  > no trip fee. All work is guaranteed, and parts carry whatever
  > warranty the manufacturer sets. Refer a friend and get a $25
  > credit toward your next service once their job is complete and
  > paid. Serving St. George, Hurricane, Washington City, Santa Clara,
  > Ivins, La Verkin, Leeds, Cedar City, and Mesquite, NV. Call or text
  > (435) 414-1667.
- **Specialties field:** Washer & dryer repair, dishwasher repair,
  refrigerator repair, range/oven repair, plumbing repairs, drywall &
  painting, furniture assembly, TV mounting, emergency repairs.
- **Business highlights to toggle on** (only the ones actually true --
  confirmed against the site's own FAQ/terms content, not guessed):
  Licensed & Insured (`index.html`'s own trust-strip already claims
  this), Guaranteed Work, Locally Owned & Operated, Emergency Services
  Offered, Accepts Credit Cards (Stripe). Skip anything Yelp offers
  that isn't independently confirmed (e.g. don't toggle "Free
  Estimates" -- pricing is set after an in-person diagnosis per the
  site's own FAQ, not a free walk-through estimate, so that highlight
  would be inaccurate).
- **Payment methods to list:** Cash, check, Venmo, Cash App, credit/
  debit card.
- **Photos:** the two GBP photos generated earlier this session (the
  current-logo profile photo and the corrected business-card cover
  photo) work here too for brand consistency, but Yelp specifically
  rewards real job-site photos more than any other platform for
  driving actual clicks-to-call -- this is the single highest-value
  place to use real job photos once they're handed off (see item 6
  above).
- **Yelp "Request a Quote" messaging button:** if Yelp's own lead
  button is enabled, make sure notifications route somewhere actually
  checked daily -- an unanswered Yelp lead is worse than no Yelp
  presence, since Yelp's own algorithm penalizes slow/no response rate
  in future placement.

**Done (2026-09-16), confirmed by the owner:** all of the above was
pasted into the live Yelp listing (About/description, specialties,
highlights, payment methods, photos, lead notification check).

<!-- Add new SEO copy drafts above this line -->

## Visual additions (things a real user/client will actually see)

User-facing UI/content changes made during the recent audit pass, for
reference:

- **Homepage conversion pop (2026-09-17)** -- orange "Leave a Google
  review" button on the homepage wall (real GBP write URL already used
  by the review-request tool), `$25 referral` on the trust rail /
  schedule rail (booking.html already has the credit from #278), tighter
  hero lede, teardown shop-drawing moved below the real before/after
  photos so Services hits sooner. AggregateRating stays 5.0 / 7 matching
  GBP; wall stays 4 written quote cards. City and service pages got a
  one-line leave-review link under "Read all reviews."
- **Washer / appliance repair in St. George** (`washer-dryer-repair-st-george-ut.html`,
  2026-09-18) -- first service × city landing page. Live path after
  merge: `/services/washer-dryer-repair-st-george-ut.html`. Clone notes in
  `docs/service-city-landing-pages.md`.
- **Refrigerator and dishwasher repair in St. George**
  (`refrigerator-repair-st-george-ut.html`,
  `dishwasher-repair-st-george-ut.html`, 2026-09-18) -- two more
  service × city pages. Dryer-only was skipped because the washer page
  already covers both laundry appliances. Live paths after merge:
  `/services/refrigerator-repair-st-george-ut.html` and
  `/services/dishwasher-repair-st-george-ut.html`.
- **Dashboard daily actions strip** (`tools/workspace.html`) -- New job,
  Create invoice, Find client, and Today's schedule sit above the Tools
  tile grid. Overdue invoices and Action Items income rows have a
  one-tap **Mark paid** (confirm, then paid in full). Job Tracker cards
  and desktop table rows have an inline **Done** that calls the existing
  status update. Advanced tools remain under **More tools**; their URLs
  are unchanged.
- **Today-first dashboard + Calendar inside Job Tracker (2026-09-21)**
  (`tools/workspace.html`, `tools/job-tracker.html`) -- the dashboard
  opens on Next Job (with a one-tap **Route today** Google Maps link
  through every address on today's schedule), Money Owed listing every
  unpaid invoice with **Mark paid**, and the **Needs attention** inbox
  open by default; the chip row, the 13-tile Tools grid, and the Backup
  drawer are gone (Backup & Restore lives on Settings). The Calendar is
  the third view on Job Tracker (List / Board / Calendar) and shows every
  dated job -- the per-job "Show on Calendar" checkbox is retired;
  `calendar.html` redirects to `job-tracker.html#calendar`. The phone
  bar is Home / Jobs / Clients / Invoices / Finance / More.

- **A 24-step tutorial, a launcher in the search box, tab deep links
  (2026-09-22, round 4)** (`tools/tools-tour.js`,
  `tools/tools-command-palette.js`, all tabbed tool pages) -- the tour
  now walks every page and tab (switching to the tab it describes),
  including where the nav bar / sidebar and the search button are; Ctrl+K
  or the round search button lists every action and place in the app
  and filters as you type; every tab has a link (`finance.html#expenses`
  etc.); Finance reopens on the last tab; the Dashboard has six daily
  actions (Quick charge and Log expense joined).

- **POS inside Invoices, tablet navigation, one less header button
  (2026-09-21, round 2)** (`tools/invoice-generator.html`,
  `tools/styles-tools.css`, `tools/runway-dashboard.html`) -- POS is the
  **Quick charge** tab on the Invoice Generator (deep link `#pos`;
  `pos.html` redirects there); same one-tap saved-card charge and
  typed-name authorization for a new card, Stripe.js loaded only at
  that moment. The bottom bar + More sheet now show on every width
  below the desktop sidebar (721-1023px used to have no navigation at
  all). The header back-to-Workspace arrow is hidden wherever the bar
  or sidebar is present, since both already carry Home.

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
- **City landing page hero distance chip** -- each of the 7 city pages
  (`handyman-cedar-city-ut.html` and siblings) now shows its own
  direction/ETA from St. George (e.g. "About 20-25 minutes east of
  St. George") right under the hero H1, so the hero reads as locally
  specific instead of the same template with only the H1 text swapped.
  Real distinct hero photography per city isn't feasible (no such
  photos exist), and each page already had the site's service-radius
  map further down focused on its own city -- this closes the gap in
  the hero itself.
- **"Liquid Glass"-inspired polish pass** (public site, `styles.css`) --
  targeted touches, not a system-wide restyle:
  - A one-time specular sheen sweeps across primary buttons on hover,
    layered on top of the existing flat fill + hard offset shadow (the
    2026-09-07 fix that deliberately killed a glossy gradient *fill*
    stays intact -- this is a light-catch effect on hover, not that).
  - Buttons and service cards get tactile press feedback (a slight
    scale-down on `:active`).
  - The service-detail modal card is now real frosted glass (blur +
    translucent fill) floating over its already-blurred scrim, instead
    of a flat opaque panel.
  - `.coverage-badge`/`.open-status` (the standard/by-request pill) and
    the new hero distance chip got a deeper blur/saturation, and the
    chip is now an actual pill (background + border) instead of plain
    inline text.
  - The theme toggle got a subtle translucent fill to match, without
    adding blur to it directly (it sits nested inside the sticky
    header, where blur has a known iOS Safari ghosting bug already
    fixed once elsewhere in this file).
  - Skipped on purpose: true cursor-tracking glow (would need a JS
    mousemove listener added to every page) and any change to the
    portal, which already has its own glass/shadow treatment.
- **Masonry gallery + category filter chips** (`our-work.html`) -- the
  62-photo gallery is now a Pinterest-style CSS multi-column layout
  (real aspect ratios, not forced crops) with clickable category chips
  ("All" + one per real `<h4>` category) that filter the visible tiles.
- **Reviews expanded from 3 to 6 per page** (`our-work.html` and all 8
  city landing pages, incl. the new `handyman-st-george-ut.html`) -- the
  same real reviews used on the homepage, shown 4-up with a
  `<details>` toggle for 2 more, replacing the old static 3-card wall.
  Stayed under the existing `<7`-cards-and-no-`aggregateRating` rule for
  non-homepage pages (see `landing-page-social-proof.test.js`) rather
  than duplicating all 7 homepage reviews everywhere.
- **"Try me" hint on the interactive slider sections** (`index.html`
  `#teardownStage`, `#revealJob`) -- a one-time pulsing glow on the
  range thumb fires when the section scrolls into view and stops for
  good the moment a visitor actually drags it.
- **Grouped FAQ lists** (`index.html`, `our-work.html`) -- the flat
  Q&A columns are now split into category sub-headings (Pricing &
  Payment, Scheduling & Availability, Service Area & Coverage,
  Policies), with the FAQPage JSON-LD reordered to match the new
  visible order exactly. The Supabase-fetched live-FAQ path still
  renders flat when it loads -- grouping that too needs a category
  column added to the `site_faq` table, not done here.
- **Custom invoice/quote line-item disclosure** (`portal/dashboard.html`,
  `portal/quotes.html`) -- the existing CSS chevron marker now gets a
  real open/close height transition (CSS-grid `0fr`/`1fr` trick)
  instead of snapping open, respecting `prefers-reduced-motion`.
- **Toast/snackbar system in the portal** (`portal/dashboard.html`,
  `portal/quotes.html`, `portal/settings.html`) -- every `alert()` on an
  error/validation path was replaced with a themed toast
  (`showToast()` in `portal/portal-app.js`), mirroring the same
  convention the internal tools suite already uses, message text
  unchanged.
- **Scroll affordance on the quote date-picker** (`portal/quotes.html`
  `.date-row`) -- a trailing-edge gradient fade now shows only when
  there's more to scroll to, and hides once scrolled to the end.
- **Lead-generation pass** (2026-09-15), from "how do we get more leads
  / more traffic":
  - **Service x city cross-links**: each of the 5 service pages
    (`assembly-installation.html` and siblings) now has a real
    `areas-links` block linking to all 7 city pages, with the service
    name baked into the visible anchor text (e.g. "Plumbing Repairs in
    Hurricane") -- targets long-tail "[service] [city]" searches that
    previously had no on-page text at all, without creating 42 thin
    near-duplicate pages (a doorway-page anti-pattern Google penalizes).
  - **Speed-to-lead note** added to the homepage's lead form, reusing
    the same honest "usually within a few hours" claim already used in
    the chat panel, so it's consistent site-wide.
  - **First-time-customer discount banner**: a dismissible 15%-off
    banner (code `WELCOME15`) now populates `#siteBanner1`, a scaffold
    every public page had declared from the start but that no script
    had ever written into or styled. Staff apply the discount manually
    via the existing "Discount label / amount" field already in the
    invoice generator. Shown on the homepage, all 7 city pages, and all
    5 service pages; dismissal is remembered via localStorage so it
    doesn't nag a returning visitor.
  - Blog post CTAs were checked and are already in good shape (every
    real post already ends with a `.blog-cta` call-to-action) -- no
    change needed there.
  - Retargeting and Google Business Profile/Local Services Ads are
    listed under "Manual action items" above -- they need an actual ad
    account or dashboard access this repo doesn't have.

- **Portal toast/snackbar** replacing every `window.alert()` in the
  client portal (`portal/quotes.html`, `portal/dashboard.html`,
  `portal/settings.html`) -- also fixed a real bug where
  `portal/work-orders.html` already called a `showToast()` that didn't
  exist anywhere in the portal, silently throwing instead of telling
  the client their message failed to send.
- **One-click "Create Invoice" from a job** (`tools/job-tracker.html` ->
  `tools/invoice-generator.html`) -- closes the "converting a recurring
  job template straight to an invoice (still fully manual each time)"
  gap noted in `README.md`'s 2026-09-16 audit entry. See that day's
  final changelog entry for the full write-up.
- **Client-facing quote PDF** (`portal/quotes.html`) -- a "Download
  PDF" button on every quote, closing the "no standalone quote PDF"
  gap `docs/CLIENT-PORTAL.md` had flagged as an intentional scope cut.
  See `README.md`'s 2026-09-16 audit entry for the full write-up.
- **Two-way messaging on a completed job** (`portal/jobs.html` and a
  new "Portal job messages" panel in `tools/clients.html`) -- closes
  the "messaging thread per job" gap noted in `docs/CLIENT-PORTAL.md`.
  See `README.md`'s 2026-09-16 audit entry for the full write-up.

- **New blog post: "Oven Not Heating Right?"** (`blog/oven-not-heating-right.html`,
  2026-09-16) -- closes the one real gap in the blog lineup: range/oven
  repair is a listed service with no post covering it, while washers,
  dryers, dishwashers, and fridges each already had one. Covers
  calibration drift, a partially-failed bake element (uneven baking),
  and a gas igniter that clicks without lighting. Uses the reserved
  farmhouse-kitchen photo from "Reserved images" above (a real supplied
  photo showing an actual range, not stock-picked for the topic).
  Linked from the blog index and `sitemap.xml`.

- **Three new appliance symptom posts** (2026-09-25):
  `blog/washer-leaking-water.html`, `blog/dryer-wont-turn-on.html`, and
  `blog/dishwasher-not-draining.html`. `js/triage.js` lists 20 symptoms
  and only 5 had a post; these cover three more of the 15 without one,
  and each post says what that symptom's triage entry already says.
  Listed on the blog index, the three appliance service pages' "Recent
  Notes From the Shop", and `sitemap.xml`. The washer post uses the
  reserved bathroom-laundry photo. The other two reuse the lead photos
  of their sibling posts (dryer-not-heating, dishwasher-not-cleaning),
  because this environment can't reach any image CDN to pick new ones.
  Swap them if you have better photos.

- **Washer/dryer service page now lists all appliance types actually
  sold** (`washer-dryer-repair.html`, 2026-09-16) -- added Dishwashers,
  Refrigerators, and Ranges & Ovens as real service cards, a matching
  FAQ entry, and a Service-schema `additionalType`, closing a gap where
  the GBP profile and three blog posts already promised those repairs
  but the dedicated service page didn't mention them. Page URL, title,
  H1, and nav label deliberately left as "Washer & Dryer Repair" --
  rebranding the page/nav into "Appliance Repair" is a bigger structural
  call, not a copy change.

- **Mobile Call + Book bar, and Schedule-first hero CTAs** (2026-09-17)
  -- on small viewports a sticky bottom bar now keeps Call and Book
  visible while scrolling (homepage, city pages, service pages,
  our-work, about, blog index). Homepage and the matching city/service
  heroes now treat Schedule as the filled orange primary and Call as
  the outline secondary, with the phone number still in the hero.
  Cookie banner, chat bubble, and back-to-top lift above the bar;
  last-content padding includes the iOS safe area. `/tools/` and
  `/portal/` are untouched. **Update (2026-09-18):** homepage and the
  washer St. George LP add Text (SMS) between Call and Book on that
  same bar; other marketing pages stay two-action.

- **Homepage high-intent FAQ next to the estimate form** (2026-09-18)
  -- compact five-question block after the hero form covering trip fee,
  same-day, warranty, repair vs replace, and payment, using existing
  FAQ copy and a link to the full FAQ modal. Hex-above-Schedule/Call
  and AggregateRating (5.0 / 7, 4 wall quotes) unchanged.

- **Stats first-paint, 16px forms, `/portal/` and `/tools/` landings**
  (2026-09-17) -- homepage stats paint 5.0 / 4 / 9 immediately instead
  of zeros; public `input, select, textarea` (email modal included) sit
  at 16px so iOS does not zoom on focus; bare `/portal/` and `/tools/`
  redirect to the login pages on a dark canvas instead of 404ing.

- **Public conversion visuals** (2026-09-17) -- mobile chrome stack
  coordinated (cookie deferred/compact over the hero; Call+Book kept;
  chat/back-to-top hidden while the cookie dialog is up). Homepage hero
  crest is secondary on small screens (96px, after the H1/CTAs, not a
  250px badge above the headline). Photo overlays lightened. Desktop
  sticky page-jump + mid-page Schedule rail shorten the path to
  `/booking.html` without deleting scroll-craft sections. Booking
  steps 2–3 get a compact sticky appointment summary on ≤960px.

- **Client portal Home inbox, next-appointment hero, pay-first invoices**
  (`portal/home.html`, `portal/dashboard.html`, and the other signed-in
  portal pages). "Needs Your Attention" is an action inbox with one-tap
  Pay / Approve / Sign / Reply into existing flows. An upcoming visit
  becomes the largest Home surface. Unpaid invoices show amount due
  above the analytics ring. Contracts sit in the Home card grid, not
  only as a footer link. The 5-tab bar is unchanged; Settings stays out
  of it. Invoice empty/error states now match quotes and jobs (icon +
  Request Work CTA on a genuine empty list).

- **Workspace ops inbox, phone More sheet, tablet Job Tracker density,
  compressed hub header** (2026-09-17) -- `/tools/` only. Action Items
  is four priority lanes (Needs response / Due this week / Follow-ups /
  Income) using the same lists and counts that already existed; unread
  highlight uses handled/submitted/overdue flags already on the row.
  Phone bottom nav keeps Home/Jobs/Invoices/Calendar/Finance and adds a
  More sheet for the dests the desktop sidebar already had. Jump-nav
  chips collapse Gallery/Compliance/Analytics/Backup behind More under
  721px. Hub header is one toolbar row (sync/status stay visible). Job
  Tracker cards tighten at 768–1023; the dense table still starts at
  1024. Auth architecture unchanged.

- **AggregateRating / review count matches GBP 5.0 from 7** (2026-09-17)
  -- owner unlock. Homepage JSON-LD, stats strip, and CTA proof lines
  (homepage + booking) now say 5.0 from 7 Google reviews. The reviews
  wall still shows only the 4 written, verified quotes; no invented
  Review cards.

- **Homepage hero hex mark above Schedule/Call** (2026-09-17) -- Connor
  asked for the large Triple H crest at the top of the homepage hero
  on a phone, above the Schedule / Call buttons instead of under
  hours. Mobile still uses the 96px signature (not a 250px billboard).
  Desktop two-column layout is unchanged (copy left, large mark
  right). Header nav logo is unchanged. AggregateRating stays 5.0 / 7.

- **Homepage above-fold estimate form** (2026-09-18) -- compact
  secondary path under the hero Schedule / Call buttons: name, phone,
  service, brief details, optional email. Submits to the same
  `th_leads` insert as the `#schedule` email modal. **Send details**
  is outline, not filled orange, so Schedule stays the only primary
  on a phone. Text us stays on the existing SMS link. Sticky
  Call+Book and AggregateRating (5.0 / 7) unchanged.

- **Shift clock: Start my day / End my day** (2026-09-23) -- a clock
  button at the top of every tools page (green pill with your start
  time while on shift, amber dot when a shift needs an end time; a row
  under New on a computer), one sheet to start or end the day, and an
  **Hours worked** card under Your week on the Dashboard with this week's
  bars and, for Owner/Developer, everyone's hours. Separate from the job
  clock, which is unchanged.
<!-- Add new visual additions above this line -->

## Proposed visual improvements (not yet built)

Ideas from a UX/visual pass over the public site and client portal,
ranked roughly by impact. None of these are implemented yet -- pick
which ones to greenlight and we'll move them into "Visual additions"
above as they ship.

1. **Add real non-flooring photos to "Other Work"** (`our-work.html`) --
   58 of 62 gallery photos are flooring/tile; only 4 cover anything
   else, and the homepage's "Recent Work" strip is literally hidden in
   code pending more variety. Real appliance-repair/plumbing/drywall
   photos would make "we do more than flooring" credible and let that
   hidden strip go live. **Still blocked: this needs real photos handed
   off from actual jobs -- nothing to build here until those exist, and
   the code can't fabricate them.**
~~2. Masonry layout + category filter chips for the gallery~~ -- **done**,
see "Visual additions" above.
~~3. Local imagery on city landing pages~~ -- **done**, see "Visual
additions" above.
~~4. Lead/hero image on every blog post~~ -- **already done** (every
post, old and new, has a `.blog-diagram` lead image).
~~5. Testimonial carousel instead of a static 3-card wall~~ -- **done**
(as a 4-then-toggle-2 review wall, not a literal carousel -- see "Visual
additions" above), on `our-work.html` and all 8 city landing pages.
6. **Un-hide the homepage "Recent Work" strip** (`index.html`
   `#recentWork`) -- still intentionally hidden, still waiting on real
   gallery variety (#1 above). Left alone on purpose.
~~7. Custom-styled invoice/quote line-item disclosure~~ -- **done**, see
"Visual additions" above.
~~8. Toast/snackbar system instead of `alert()` in the portal~~ --
**done**, see "Visual additions" above.
~~9. Scroll affordance on the quote date-picker~~ -- **done**, see
"Visual additions" above.
~~10. "Try me" hint on the interactive slider sections~~ -- **done**, see
"Visual additions" above.
~~11. Group/categorize the FAQ list~~ -- **done**, see "Visual additions"
above.
12. **Photo thumbnails on the busiest service cards** (`index.html`
    `.services-grid`) -- all six cards use identical-style line-icon
    SVGs. Swapping 1-2 of the busiest (Appliance Repair, Emergency
    Calls) for a real photo thumbnail would add warmth over icon-only.
    Same blocker as #1/#6: needs a real photo, not a fabricated one.
~~13. Loading indicator during initial portal auth check~~ -- **already
done**, found stale during a 2026-09-22 check (verified against the
live files, not assumed): `portal/dashboard.html`'s `#invoiceList` and
`portal/quotes.html`'s `#quoteList` both bake the skeleton-card markup
directly into their static HTML now, not just injected by JS after the
session check -- fixed as part of the 2026-09-21 "client portal no
longer flashes blank on first load" work (`docs/specialist-logs/features.md`),
this item just wasn't crossed off when that landed. No blank-white
instant remains; the skeleton is the very first thing painted.

~~14. Tablet 721-1023px band with no navigation~~ -- **already done**,
same stale-item check: `tools/styles-tools.css`'s "Tablet band fix
(2026-09-21)" already covers this (see the note under "POS inside
Invoices, tablet navigation..." above). Left here as a placeholder so
a future pass doesn't waste time re-diagnosing the FAQ item -- no
action needed.

<!-- Add new proposed visual improvements above this line -->
