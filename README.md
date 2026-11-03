# ekorn

Lossless, recallable tool-output packing for coding agents.

Large command outputs are stored verbatim on your machine and replaced in the
agent's context by a short, exact summary. Anything the agent needs later can be
recalled line-by-line. Nothing leaves your machine.

ekorn 把编码代理里的大输出原样存在本机、只给模型看精确摘要，需要时逐行取回。
数据不出你的机器。

## Status

Pre-release. This repository holds the plugin shells and the CLI launchers; the
core ships as a single static binary under
[Releases](https://github.com/ekornhq/ekorn/releases). Until the first core
release every shell is a no-op: installing it changes nothing in your agent.

## Install

Core binary (all harnesses): download `ekorn-core` for your platform from
Releases and put it at `~/.ekorn/bin/ekorn-core` (or set `EKORN_CORE`).

| Harness | Shell | Install |
| --- | --- | --- |
| Claude Code | `plugins/claude` | `/plugin marketplace add ekornhq/ekorn` then `/plugin install ekorn@ekorn` |
| Codex CLI | `plugins/codex` | `codex plugin marketplace add ekornhq/ekorn` then `/plugins` → ekorn; approve hooks with `/hooks` |
| DeepSeek Harness | `plugins/dsh` | `dsh plugin --profile web add dsh-ekorn` (after the npm release) |
| CLI launcher | `packages/*` | `npm i -g ekorn` · `pipx install ekorn` · `cargo install ekorn` |

Each shell's README lists what it registers and its caveats.

## What the core provides

```
ekorn hook session-start    # injects the token discipline as context
ekorn hook pre-tool-use     # wraps large Bash outputs, limits unbounded Read (updatedInput)
ekorn hook stop             # compaction advisor
ekorn mcp                   # stdio MCP server: edit_then_run, write_then_run, obs_recall
ekorn pack --run <cmd>      # run a command, archive the output, print the summary
ekorn pack --stdin --label <name>
ekorn recall <id> [--grep PAT | --lines A:B | --offset N]
ekorn verify --source <path|id> --receipt <json>
ekorn probe [--json | --ledger]
```

`EKORN_HOME` (default `~/.ekorn`) holds the core and its archive.
`EKORN_OFF=1` disables packing for a session.

## Layout

```
.claude-plugin/marketplace.json   Claude Code marketplace
.agents/plugins/marketplace.json  Codex marketplace
plugins/claude                    Claude Code plugin (hooks, MCP, agent, skill, launcher)
plugins/codex                     Codex plugin, portable Agent Plugins layout
plugins/dsh                       DeepSeek Harness plugin (npm bundle, tools/post-execute)
packages/npm, pypi, crates        `ekorn` launcher for each registry
.github/workflows/publish-shims.yml
```

## License

Shells, launchers and documentation in this repository: MIT. The core binary is
distributed under its own license. The packing approach was inspired by
[NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) (MIT); this is an independent
implementation and contains none of its source.
