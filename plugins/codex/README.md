# ekorn for Codex CLI

Plugin shell in the portable Agent Plugins layout (`plugin.json`, `mcp.json`,
`hooks/hooks.json`, `skills/`). The behaviour lives in the ekorn core binary.

```
codex plugin marketplace add ekornhq/ekorn
codex            # then /plugins → install ekorn, start a new session
```

Requirements and caveats:

- Put the core binary at `~/.ekorn/bin/ekorn-core` (from
  [Releases](https://github.com/ekornhq/ekorn/releases)) or set `EKORN_CORE`.
  Without it the hooks are no-ops.
- The MCP server entry runs `ekorn mcp` from `PATH`, so install the CLI shim
  first: `npm i -g ekorn`, `pipx install ekorn` or `cargo install ekorn`.
- Codex does not trust plugin hooks automatically. After installing, run
  `/hooks` inside Codex and approve the three ekorn hooks (`SessionStart`,
  `PreToolUse` on `Bash`, `Stop`). Hooks are on by default in current Codex;
  if you disabled them, re-enable with `hooks = true` under `[features]` in
  `~/.codex/config.toml`.
- Only verified against the official plugin docs, not yet against a live Codex
  install. Please open an issue with the exact error if something does not load.

Set `EKORN_OFF=1` to disable packing for a session.
