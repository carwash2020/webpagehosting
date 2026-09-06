---
name: superpowers-plugins
description: >
  Reference for the Superpowers marketplace by Jesse Vincent (obra) — 10 plugins
  covering TDD and debugging workflows, brainstorm/plan/execute commands, Chrome
  DevTools control, cross-session semantic memory, private journaling, writing
  guidance from Strunk's Elements of Style, plugin-development docs, and
  multi-session orchestration. Use when the user mentions Superpowers, obra,
  superpowers-marketplace, or asks about plugin marketplaces, installing or
  managing plugins, /plugin commands, what a given Superpowers plugin does, or
  which plugin provides a capability like browser control, episodic memory,
  session driving, or the brainstorm and write-plan workflow.
---

# Superpowers Marketplace

A plugin marketplace, not a single skill. Ten plugins by Jesse Vincent
(`obra`), catalogued at
<https://github.com/obra/superpowers-marketplace>. Each entry below is a
separate git repository installed through Claude Code's plugin system.

Marketplace version 1.0.13. Versions listed are those pinned in the catalog at
snapshot time — check upstream for current releases.

## Platform reality — read this before recommending

Plugins are a **Claude Code feature only**. They install into the CLI and
desktop app. They do **not** run on iOS, Android, or claude.ai in the browser,
because those surfaces have no plugin runtime, no MCP servers, and no shell.

This skill therefore carries *knowledge about* the marketplace everywhere,
including phone. The plugins' actual behavior stays on Claude Code. Never tell
someone a plugin will work on their phone.

## The plugins

| Plugin | Version | What it gives you |
|---|---|---|
| `superpowers` | 6.3.0 | The core library. 20+ skills for TDD, debugging, and collaboration; `/brainstorm`, `/write-plan`, `/execute-plan` commands; a skills-search tool; SessionStart context injection. Start here. |
| `superpowers-chrome` | 3.0.5 | Chrome DevTools Protocol access via a `browsing` skill. Two modes — CLI commands, or a single `use_browser` MCP tool. Zero dependencies, auto-starts Chrome. |
| `elements-of-style` | 1.0.0 | A `writing-clearly-and-concisely` skill plus the full 1918 Strunk text (~12k tokens) and all 18 rules. |
| `episodic-memory` | 1.4.2 | Semantic search across past Claude Code and Codex conversations, so decisions and patterns survive between sessions. |
| `superpowers-lab` | 0.5.0 | Experimental: tmux automation for interactive CLIs, MCP server discovery, duplicate-function detection, headless Windows VM. |
| `superpowers-developing-for-claude-code` | 0.3.1 | 42+ official documentation files for building plugins, skills, MCP servers, and extensions, with a self-update mechanism. |
| `superpowers-dev` | 0.0.2026021001 | Dev branch of core. **Uninstall other Superpowers versions first** — the catalog says so explicitly. Not for normal use. |
| `claude-session-driver` | 4.0.0 | Launch, control, and monitor other Claude Code sessions as workers over tmux. |
| `private-journal-mcp` | 2.0.1 | MCP journaling server: multi-section entries, local embeddings for semantic search, project-local and user-global storage. |
| `double-shot-latte` | 1.2.0 | Suppresses "Would you like me to continue?" by having a model judge whether work should continue. |

## Installing

```bash
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Then restart the session. See `references/installing.md` for committing the
marketplace to a repo so teammates get it, and for what to check before
installing.

## Guidance when recommending

- **`superpowers` first.** Most of the value is in the core plugin; the others
  are add-ons. Don't recommend the full set at once.
- **Skip `superpowers-dev`** unless the user is deliberately testing upstream —
  it conflicts with the stable core.
- **These run code.** `claude-session-driver` drives other sessions,
  `superpowers-lab` automates tmux and spins up VMs, `private-journal-mcp` and
  `episodic-memory` index conversation history locally. Say what a plugin
  touches when you recommend it.
- **`episodic-memory` and `private-journal-mcp` read your conversations.**
  Storage is local, but flag it — some users won't want it.
- This is one person's marketplace, unaffiliated with Anthropic. Treat it as
  well-regarded community software, not a supported product.
