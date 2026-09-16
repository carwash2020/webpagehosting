# Specialist logs

This project is worked from 7 separate specialist chats, each loading its own
skill (`tripleh-visual`, `tripleh-bugfix`, `tripleh-features`,
`tripleh-automation`, `tripleh-reports`, `tripleh-content`,
`tripleh-security`) instead of one general-purpose chat. The point is to keep
each lane's context focused and stop cross-over between unrelated kinds of
work.

Each specialist reads its own log at the start of a session and appends to it
at the end — this is how a specialist "remembers" past decisions across
separate chats, the same way `README.md`'s changelog works for the whole
project, just scoped to one lane. It's also how the specialists leave notes
for *each other*: if the visual specialist notices a real bug while styling
something, it writes one line to `bugfix.md` instead of fixing it inline.

- `visual.md` — layout, CSS, theming, motion, accessibility, image placement
- `bugfix.md` — defects, root causes, test-suite gotchas
- `features.md` — new functionality, schema changes, architectural decisions
- `automation.md` — scheduled/triggered work, CI, notification pipelines
- `reports.md` — business/analytics reporting, data-source quirks
- `content.md` — blog/page copy, GBP/Yelp/directory drafts, SEO content decisions
- `security.md` — auth/payment/RLS findings, risk-acceptance calls

Keep entries short and dated. Log real decisions and gotchas worth knowing
before touching the same area again — not a line-by-line changelog of every
file touched (that's what `README.md`'s own changelog is for).
