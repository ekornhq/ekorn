# ekorn for Claude Code

Plugin shell. The behaviour lives in the ekorn core binary; this directory only
wires it into Claude Code.

```
/plugin marketplace add ekornhq/ekorn
/plugin install ekorn@ekorn
```

Then put the core binary at `~/.ekorn/bin/ekorn-core` (download from
[Releases](https://github.com/ekornhq/ekorn/releases)) or set `EKORN_CORE` to
its path. Until the core is installed every hook is a no-op and Claude Code
behaves exactly as before.

What the shell registers:

| Component | File | Purpose |
| --- | --- | --- |
| `SessionStart` hook | `hooks/hooks.json` | injects the token discipline as additional context |
| `PreToolUse` hook (Bash, Read) | `hooks/hooks.json` | wraps large outputs with `ekorn pack`, limits unbounded `Read` |
| `Stop` hook | `hooks/hooks.json` | compaction advisor |
| MCP server `ekorn` | `.mcp.json` | `edit_then_run`, `write_then_run`, `obs_recall` |
| agent `log-reducer` | `agents/log-reducer.md` | reads long logs in its own context, returns verbatim-verified receipts |
| skill `token-discipline` | `skills/token-discipline/SKILL.md` | the four rules, loaded on demand |
| `bin/ekorn` | launcher | on the Bash PATH inside Claude Code, so `ekorn recall <id>` works |

Set `EKORN_OFF=1` to disable packing for a session.
