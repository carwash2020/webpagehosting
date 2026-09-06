# Installing and managing Superpowers plugins

## Before you install

Plugins execute code on your machine — commands, hooks, and MCP servers, with
no sandbox between them and your shell. Before installing any of these:

1. Open the plugin's repository and read its `SKILL.md` files and any
   `hooks/`, `scripts/`, or MCP server source.
2. Note what it persists and where. `episodic-memory` and
   `private-journal-mcp` both index your conversation history to local disk.
3. Prefer a pinned version over tracking a moving branch, and never install
   `superpowers-dev` alongside `superpowers`.

## Interactive install (per machine)

```bash
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Useful follow-ups:

```bash
/plugin                              # browse and manage installed plugins
/plugin marketplace update obra/superpowers-marketplace
/plugin uninstall superpowers@superpowers-marketplace
```

Restart the session after installing — skills and commands are read at startup.

## Committing it to a repository

To make a marketplace and plugin set part of a project so collaborators get it
on clone, declare them in the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "superpowers-marketplace": {
      "source": { "source": "github", "repo": "obra/superpowers-marketplace" }
    }
  },
  "enabledPlugins": {
    "superpowers@superpowers-marketplace": true
  }
}
```

Each collaborator still confirms the install locally — committing this
advertises the plugin, it does not silently run third-party code on their
machine.

## What does not work

- **Phone and web.** No plugin runtime on iOS, Android, or claude.ai. Nothing
  in this marketplace functions there.
- **Ephemeral remote sessions.** A plugin installed in a throwaway container
  disappears with it. Use the committed-settings approach instead.

## If you only want the ideas, not the plugin

Several plugins are mostly markdown — `elements-of-style` is a skill plus a
reference text. Where the license permits, that content can be copied into a
local skill under `.claude/skills/` and uploaded to claude.ai for use on phone.
Check the upstream LICENSE first, and keep attribution.
