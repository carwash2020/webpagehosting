# Installing a skill you found in this index

## Vet it first

Before installing any third-party skill:

1. Open the repo and read `SKILL.md` end to end. The description and body are
   injected into Claude's context — treat surprising instructions as a red flag.
2. List the directory. A skill is usually just markdown. If there is a
   `scripts/`, `bin/`, or `hooks/` directory, read every file — those execute.
3. Look for anything that reads credentials, `.env` files, SSH keys, or posts
   data to a URL you don't recognize.
4. Check the repo has real history and isn't a single drive-by commit.

Anthropic-published skills (`github.com/anthropics/skills`) don't need this
scrutiny. Everything else does.

## Claude Code (desktop / CLI)

Project-scoped — versioned with the repo, available to anyone who clones it:

```
mkdir -p .claude/skills
git clone --depth 1 <repo-url> /tmp/skill-src
cp -r /tmp/skill-src/<path-to-skill> .claude/skills/<skill-name>
```

Personal — available in every project on that machine, not committed anywhere:

```
cp -r /tmp/skill-src/<path-to-skill> ~/.claude/skills/<skill-name>
```

The skill directory must contain a `SKILL.md` with YAML frontmatter holding
`name` and `description`. Restart the session (or start a new one) to pick it up.

## claude.ai — web, iOS, and Android

Skills uploaded to the account sync to every surface, including phone. A skill
installed only under `.claude/skills/` in a repo does **not** reach mobile.

1. Zip the skill directory so that `SKILL.md` sits at the top level of the
   archive (zip the folder's contents, not a parent wrapper):
   ```
   cd .claude/skills/<skill-name> && zip -r ../<skill-name>.zip .
   ```
2. On the web at claude.ai, open **Settings → Capabilities → Skills**.
3. Choose **Upload skill** and select the zip.
4. Enable it. It now appears in Claude on iOS and Android automatically.

Uploading must be done from the web interface — the mobile apps can use synced
skills but cannot upload new ones.

## Which scope to pick

| Need | Scope |
|---|---|
| Team should get it with the repo | `.claude/skills/` (commit it) |
| Just you, all local projects | `~/.claude/skills/` |
| Phone / web / anywhere you're signed in | Upload zip to claude.ai settings |
| All three | Commit it, and also upload the zip |
