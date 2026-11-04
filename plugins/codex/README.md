# ekorn for Codex CLI

Plugin shell in the portable Agent Plugins layout (`plugin.json`, `mcp.json`,
`hooks/hooks.json`, `skills/`). The behaviour lives in the ekorn core binary.

```
codex plugin marketplace add ekornhq/ekorn
codex            # then /plugins → install ekorn, start a new session
```

Requirements and caveats:

- Put the core binary at `~/.ekorn/bin/ekorn-core` (see the
  [install steps](../../README.md#install); v0.1.0 or later) or set `EKORN_CORE`.
  Without it the hooks are no-ops.
- The MCP server entry runs `ekorn mcp` from `PATH`, so install the CLI launcher
  first: `npm i -g ekorn`, `pipx install ekorn` or `cargo install ekorn`.
- Codex does not trust plugin hooks automatically. After installing, run
  `/hooks` inside Codex and approve the five ekorn hooks: `SessionStart`,
  `PreToolUse` and `PostToolUse` on `Bash`, `PreCompact`, `Stop`. Hooks are on
  by default in current Codex; if you disabled them, re-enable with
  `hooks = true` under `[features]` in `~/.codex/config.toml`.
- Because the plugin carries lifecycle hooks it is not eligible for the public
  Codex plugin directory; the marketplace command above (or a manual copy) is
  the install path.
- Codex has no `Read` tool (file edits go through `apply_patch`), so only the
  shell-output half of ekorn applies here; the `Read` cap of the Claude Code
  shell has no counterpart.
- Only verified against the official plugin docs, not yet against a live Codex
  install. Please open an issue with the exact error if something does not load.

What the hooks do: `PreToolUse` rewrites a large-output shell command into
`ekorn pack --run …` via `updatedInput`; `PostToolUse` and `PreCompact` feed the
local ledger behind `ekorn report` / `ekorn tune`; `SessionStart` injects the
token discipline as `additionalContext`; `Stop` returns the compaction advice as
a `systemMessage`.

Set `EKORN_OFF=1` to disable packing for a session. `ekorn --version` prints
the core version line followed by `ekorn shim 0.1.0 (plugins/codex)`.
