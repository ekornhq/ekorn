# ekorn

Lossless, recallable tool-output packing for coding agents.

Large command outputs are stored verbatim on your machine and replaced in the
agent's context by a short, exact summary. Anything the agent needs later can be
recalled line-by-line. A local usage ledger shows where tokens actually go and
suggests evidence-backed policy changes. Nothing leaves your machine.

ekorn 把编码代理里的大输出原样存在本机、只给模型看精确摘要，需要时逐行取回；
本机账本告诉你 token 花在哪、该怎么调。数据不出你的机器。

## Status

The core is published: `ekorn-core` **v0.1.0** is on
[Releases](https://github.com/ekornhq/ekorn/releases) as a static binary for
linux/darwin × amd64/arm64 and windows/amd64, with `sha256sums.txt`.

This repository holds the plugin shells and the CLI launchers (all at shell
version 0.1.0). A shell without the core is a no-op: hooks exit silently and
your agent behaves exactly as before.

## Install

### 1. Core binary (every harness)

```sh
os=$(uname -s | tr '[:upper:]' '[:lower:]'); arch=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
mkdir -p ~/.ekorn/bin && cd ~/.ekorn/bin
curl -fsSLO "https://github.com/ekornhq/ekorn/releases/latest/download/ekorn-core_${os}_${arch}"
curl -fsSLO  https://github.com/ekornhq/ekorn/releases/latest/download/sha256sums.txt
sha256sum -c --ignore-missing sha256sums.txt      # macOS: shasum -a 256 -c --ignore-missing sha256sums.txt
mv "ekorn-core_${os}_${arch}" ekorn-core && chmod +x ekorn-core
./ekorn-core --version                            # ekorn-core v0.1.0
```

Windows: download `ekorn-core_windows_amd64.exe`, check it against
`sha256sums.txt`, and save it as `%USERPROFILE%\.ekorn\bin\ekorn-core.exe`.

Any other location works if you point `EKORN_CORE` at the file.

### 2. Wire it into your agent — pick ONE route

**Route A — plugin shell.** Everything comes from this repository; nothing in
your settings is edited.

| Harness | Shell | Install |
| --- | --- | --- |
| Claude Code | `plugins/claude` | `/plugin marketplace add ekornhq/ekorn` then `/plugin install ekorn@ekorn` |
| Codex CLI | `plugins/codex` | `codex plugin marketplace add ekornhq/ekorn` then `/plugins` → ekorn; trust the hooks with `/hooks` |
| DeepSeek Harness | `plugins/dsh` | `dsh plugin --profile web add dsh-ekorn` (after the npm release) |

**Route B — manual setup (Claude Code only).** The core edits your Claude Code
configuration itself: hooks and the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` default
into `~/.claude/settings.json`, the token discipline into `~/.claude/CLAUDE.md`
(between `<!-- ekorn:begin -->` and `<!-- ekorn:end -->`), the `log-reducer`
agent and the MCP server. Every touched file is backed up first
(`*.ekorn-bak.<timestamp>`); the command is idempotent.

```sh
~/.ekorn/bin/ekorn-core setup claude                 # install
~/.ekorn/bin/ekorn-core setup claude --uninstall     # remove everything it added; the archive stays
```

Route A and Route B register the same hooks. Installing both makes every hook
fire twice and double-counts the usage ledger — choose one. Route A cannot set
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` for you; set it in `settings.json` → `env` if
you want the native auto-compact ceiling (the core defaults to 250000 in Route B).

Optional CLI launcher, so `ekorn …` works in any shell:
`npm i -g ekorn` · `pipx install ekorn` · `cargo install ekorn` (packages under
`packages/`). The launcher just forwards to the core.

### 3. Check

```sh
~/.ekorn/bin/ekorn-core --version   # ekorn-core v0.1.0
ekorn --version                     # a shell or launcher prints the core line, then "ekorn shim 0.1.0 (…)"
```

The second line tells you which shell is in play; include both lines in bug reports.

## What the core provides

```
ekorn hook session-start      # injects the token discipline as additionalContext (plugin route)
ekorn hook pre-tool-use       # wraps large Bash outputs in `ekorn pack`, caps unbounded Read (updatedInput)
ekorn hook post-tool-use      # appends one line per Bash/Read (shape, bytes, packed?) to the local ledger
ekorn hook pre-compact        # records a compaction boundary for the rework analysis
ekorn hook stop               # compaction advisor + daily tune notices
ekorn mcp                     # stdio MCP server: edit_then_run, write_then_run, obs_recall
ekorn pack --run '<cmd>' [--timeout S]      # run, archive output >16 KiB, print the exact summary
ekorn pack --stdin [--label L]
ekorn recall <id> [--grep RE [-i] [-C N] | --lines A-B | --offset N] [--max-bytes N]
ekorn verify --source <file|id> --receipt <json>    # verbatim check of a log-reducer receipt
ekorn probe [--days N | --since DATE] [--json | --ledger | --compare baseline.json]
ekorn report [--days N] [--json]            # coverage, missed packs, recall rate, repeated full reads
ekorn tune [--apply ID|all | --revert ID | --history | --explain ID | --auto on|off]
ekorn setup claude [--uninstall] [--autocompact N|auto] [--claude-dir DIR] [--no-mcp] [--auto yes|no]
ekorn rules                   # print the discipline text that session-start injects
ekorn --version               # ekorn-core <version>
```

Markers in the agent's context: a packed result starts with `[ekorn-pack]`,
a recalled slice with `[ekorn-recall]`.

Environment and files:

| | |
| --- | --- |
| `EKORN_HOME` | data directory, default `~/.ekorn` (archive, ledger, policy) |
| `EKORN_CORE` | path of the core binary; overrides `$EKORN_HOME/bin/ekorn-core` |
| `EKORN_STORE` | archive directory, if you want it elsewhere |
| `EKORN_OFF=1` | disable every hook for this session |
| `~/.ekorn/policy.json` | thresholds and wrap patterns; written by `ekorn tune --apply`, editable by hand (code default < policy < env) |

The ledger is plain JSONL under `EKORN_HOME`. It stores command shapes and byte
counts, never tool output (archived packs excepted). Delete it whenever you like.

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
