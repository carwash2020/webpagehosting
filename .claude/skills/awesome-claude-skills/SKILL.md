---
name: awesome-claude-skills
description: >
  Searchable directory of 204 community and Anthropic-built Claude Agent Skills
  across 13 categories — documents, development, data, science, writing,
  learning, media, health, collaboration, security, automation, and skill
  collections. Use when the user asks whether a skill exists for something,
  wants to find, discover, browse, compare, or recommend a Claude skill or
  skill marketplace, asks "is there a skill for X", "what skills are out there
  for X", "find me a skill that does X", wants to install a third-party skill,
  or is deciding whether to build a skill from scratch versus adopt an existing
  one. Also use for questions about where to get skills, skill directories,
  or skill collections/marketplaces.
---

# Awesome Claude Skills

A curated index of publicly available Claude Agent Skills, sourced from the
[Awesome Claude Skills](https://github.com/BehiSecc/awesome-claude-skills)
directory. 204 entries, each with a name, source link, and one-line description.

## How to use this skill

1. **Identify the category** the user's need falls into (table below).
2. **Read only that reference file** — do not load all of them. Each is a flat
   list of `- [name](url) - description` lines, so `grep` works well:
   `grep -i "seo" references/*.md`
3. **Recommend 2–4 candidates**, not the whole list. Name each one, say what it
   does, and give the link.
4. **Check `references/collections.md`** when the need is broad (e.g. "marketing
   skills", "academic skills") — a bundle often beats a single skill.
5. **Vet before installing.** See `references/installing.md`.

If nothing in the index fits, say so plainly and suggest building one with the
`skill-creator` skill rather than forcing a poor match.

## Categories

| Reference file | Contents | Entries |
|---|---|---|
| `references/document-skills.md` | docx, pdf, pptx, xlsx, presentations, document extraction | 6 |
| `references/development-and-code.md` | TDD, git, debugging, AWS/Terraform, testing, linting, plugin authoring, code intelligence | 46 |
| `references/data-and-analysis.md` | databases, dashboards, BI, ETL, analytics, spreadsheets-as-data | 18 |
| `references/science-and-research.md` | bioinformatics, chemistry, academic tooling | 6 |
| `references/writing-and-research.md` | drafting, editing, style, deep research, citations | 13 |
| `references/learning-and-knowledge.md` | tutoring, note systems, knowledge bases | 6 |
| `references/media-and-content.md` | video, image, audio, social publishing, design assets | 24 |
| `references/health-and-life-sciences.md` | clinical, fitness, medical data | 3 |
| `references/collaboration-and-pm.md` | Jira/Linear/Notion, PRDs, standups, meeting notes, project workflows | 21 |
| `references/security-and-web-testing.md` | appsec review, pentest tooling, vulnerability scanning, secure vibe-coding | 11 |
| `references/utility-and-automation.md` | scheduling, scraping, file wrangling, glue automation | 17 |
| `references/articles-and-posts.md` | write-ups about building skills | 1 |
| `references/collections.md` | multi-skill bundles, marketplaces, and directories | 32 |

## Guidance when recommending

- **Anthropic-published skills** (`github.com/anthropics/skills`) are the safest
  default and several are already built into this environment (`docx`, `pdf`,
  `pptx`, `xlsx`). Don't recommend installing a duplicate of one already active.
- **Community skills are unreviewed third-party code.** Any skill with a
  `scripts/` directory can run commands. Read `SKILL.md` and any scripts before
  installing — say this out loud when recommending one.
- **Directory-only entries** (Agent Skills Hub, Skillselion, AugmentClaude,
  Remote OpenClaw, CreatorSkills) are websites, not installable skills.
- The index is a **snapshot**, not live. Links can rot and descriptions are the
  authors' own claims. Verify the repo still exists before telling the user to
  install it.

## Refreshing the index

Re-fetch <https://github.com/BehiSecc/awesome-claude-skills/blob/main/README.md>
and re-split by `##` heading into the reference files above, keeping each entry
line verbatim.
