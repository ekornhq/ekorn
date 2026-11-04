# ekorn for Claude Code

Plugin shell. The behaviour lives in the ekorn core binary; this directory only
wires it into Claude Code.

```
/plugin marketplace add ekornhq/ekorn
/plugin install ekorn@ekorn
```

Then put the core binary at `~/.ekorn/bin/ekorn-core` (see the
[install steps](../../README.md#install); v0.1.0 or later) or set `EKORN_CORE`
to its path. Until the core is installed every hook is a no-op and Claude Code
behaves exactly as before.

## Two routes, pick one

The plugin (this directory) and `ekorn-core setup claude` install the same
hooks. Use one of them:

| | Plugin route | `setup claude` route |
| --- | --- | --- |
| Hooks, MCP, `log-reducer` agent | from the plugin | written into `~/.claude/settings.json` / `agents/` |
| Token discipline | injected per session by the `SessionStart` hook | written into `~/.claude/CLAUDE.md` |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | not set — add it to `settings.json` → `env` yourself | set to 250000 (`--autocompact N|auto`) |
| Remove | `/plugin uninstall ekorn@ekorn` | `ekorn-core setup claude --uninstall` |

With both installed every hook fires twice and the usage ledger double-counts.

## What the shell registers

| Component | File | Purpose |
| --- | --- | --- |
| `SessionStart` hook | `hooks/hooks.json` | injects the token discipline (`ekorn rules`) as additional context; runs the daily tune tick |
| `PreToolUse` hook (`Bash`, `Read`) | `hooks/hooks.json` | wraps large outputs with `ekorn pack`, caps unbounded `Read` (`updatedInput`) |
| `PostToolUse` hook (`Bash`, `Read`) | `hooks/hooks.json` | appends one line per call (command shape, bytes, packed or not) to the local ledger — the data behind `ekorn report` and `ekorn tune` |
| `PreCompact` hook | `hooks/hooks.json` | records the compaction boundary so the report can measure rework after compaction |
| `Stop` hook | `hooks/hooks.json` | compaction advisor; shows pending tune notices once |
| MCP server `ekorn` | `.mcp.json` | `edit_then_run`, `write_then_run`, `obs_recall` |
| agent `log-reducer` | `agents/log-reducer.md` | reads long logs in its own context, returns verbatim-verified receipts |
| skill `token-discipline` | `skills/token-discipline/SKILL.md` | the four rules, loaded on demand |
| `bin/ekorn` | launcher | what the hooks and the MCP entry call; forwards to the core |

`bin/ekorn` is not added to your shell `PATH`. For the commands below use the
core directly or install a CLI launcher (`npm i -g ekorn`, `pipx install ekorn`,
`cargo install ekorn`).

## Day-to-day commands

```sh
~/.ekorn/bin/ekorn-core report            # where the tokens went: coverage, missed packs, recall rate, repeated full reads
~/.ekorn/bin/ekorn-core tune              # evidence-backed suggestions; --apply <id>, --explain <id>, --history
~/.ekorn/bin/ekorn-core tune --auto on    # let the daily tick apply the safe knobs itself (with an observation period)
~/.ekorn/bin/ekorn-core rules             # the discipline text the SessionStart hook injects
~/.ekorn/bin/ekorn-core recall <id> --grep PATTERN   # same as the obs_recall MCP tool
~/.ekorn/bin/ekorn-core --version
```

Policy lives in `~/.ekorn/policy.json`. Lines listed under `rules_extra` there are appended
to the injected discipline from the next session on.

Set `EKORN_OFF=1` to disable packing for a session. `ekorn --version` (any
shell) prints the core version line followed by `ekorn shim 0.1.0 (plugins/claude)`.
