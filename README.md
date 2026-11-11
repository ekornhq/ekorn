# ekorn

A token-saving toolkit for coding agents.

An agent re-sends its whole conversation with every request, so anything that
enters the context is paid for again on every later turn. ekorn cuts that cost
in four ways: it keeps large output out of the context (stored on your machine,
fetched back exactly when needed), removes avoidable round trips, compacts the
conversation at the right time, and measures the result so its settings can be
tuned from evidence. It runs through the agent's hooks, so there is nothing to
remember to do.

ekorn 是给编码代理用的省 token 工具集。代理每次请求都会把整段对话重发一遍，
进了上下文的内容之后每一轮都要再付一次。ekorn 从四处省：大输出不进上下文
（原样存本机，需要时逐行取回）、减少多余的模型往返、在合适的时机压缩对话、
用本机账本量出效果并据此调参。全部通过钩子自动生效，你的数据不出你的机器。

Works with Claude Code, Codex CLI and DeepSeek Harness. Claude Code gets all of
it; the [table below](#what-each-harness-gets) shows the rest.

## How it saves tokens

### 1. Large output stays out of the context

A hook wraps shell commands that tend to print a lot. Output over 16 KiB is
archived verbatim and the model sees an exact summary instead. A 30,000-line
output becomes this (summary text is currently in Chinese):

```
[ekorn-pack] shell 输出 168893 字节 / 30000 行，已归档，上下文只保留摘要
id: obs_57ed597060d172dd
path: ~/.ekorn/store/<session>/obj/obs_57ed597060d172dd.txt
recall: ekorn recall obs_57ed597060d172dd --offset 0            # 按字节精确翻页
grep:   ekorn recall obs_57ed597060d172dd --grep 'PATTERN'      # 只取命中行(带行号)
--- 头 60 行 ---
…
--- 中间省略 29915 行 / 168573 字节 ---
--- 尾 25 行 ---
…
```

and the model gets any part back, byte for byte, when it needs it:

```
$ ekorn recall obs_57ed597060d172dd --lines 29999-29999
[ekorn-recall id=obs_57ed597060d172dd lines=29999-29999 of 168893 bytes]
  29999: 29999
```

Two more things keep large content out:

- **File reads are capped.** A read of a large file with no range is limited,
  so the model pages through the part it needs instead of loading the whole file.
- **Long logs go to a sub-agent.** The `log-reducer` agent reads a long log in
  its own context and brings back only the lines that matter, each one checked
  word for word against the source by `ekorn verify`.

### 2. Fewer round trips

- **Edit and check in one call.** The MCP tools `edit_then_run` and
  `write_then_run` change a file and run your build or test in the same tool
  call, instead of an edit, a reply, and then a separate command.
- **Four rules at session start.** A hook gives the model a short discipline:
  combine an edit with its check, fetch from a packed result instead of running
  the command again, search before reading a large file, keep commands short.

### 3. Compaction at the right time

- **Auto-compact ceiling.** `ekorn setup claude` sets Claude Code's
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (250000 by default), so the conversation is
  compacted at that size instead of growing to the model's full window.
- **Compaction advisor.** At the end of a turn ekorn tells you when compacting
  would pay off, with the estimated tokens saved per request. It stays quiet
  otherwise.
- **Compaction by cache price (DeepSeek Harness).** There the plugin does not
  advise, it acts: from the session's own token counts and the model's prices
  for cached input, uncached input and output it works out when a compaction
  pays for itself, and runs dsh's own compaction at the next idle moment. It
  leaves a context under a quarter of the model's window alone, because that
  compaction keeps nothing word for word. Nothing to configure.

### 4. Measure, then tune

- **Ledger.** Hooks record every shell and read call (command shape and byte
  counts, never the output) and every compaction.
- **Report.** `ekorn report` shows what share of large output was packed, what
  was missed, how often a summary had to be fetched back, and repeated full reads.
- **Suggestions.** `ekorn tune` proposes threshold and pattern changes, each
  with its evidence and a replay of what it would have done. Apply and revert
  them one at a time, or let ekorn do it automatically within fixed limits; a
  change that makes things worse is rolled back.
- **Totals.** `ekorn probe` adds up token use from your agent's session logs
  over a period and compares it with a saved baseline.

### What each harness gets

| | Claude Code | Codex CLI | DeepSeek Harness |
| --- | --- | --- | --- |
| Large output packed | shell commands, before they run | shell commands, before they run | any tool's text result (except `read`), after it returns |
| Unbounded file reads capped | yes | no | no |
| Recall | yes | yes | yes |
| `edit_then_run`, `write_then_run` | yes | yes | no |
| Four rules at session start | yes | yes | no |
| `log-reducer` sub-agent | yes, on Haiku | no | yes, on `deepseek-flash` |
| Auto-compact ceiling | with `setup claude`; by hand with the plugin | no | dsh has its own (80% of the window) |
| Compaction advisor | yes | yes | not needed |
| Compaction by cache price, automatic | no | no | yes, for `deepseek-flash` and `deepseek-v4-pro` |
| Ledger, report, suggestions | every shell and read call | every shell call | packed results and recalls |
| Core binary | you install it (one command) | you install it (one command) | the plugin installs it |
| Checked on | Linux, in daily use | not yet run in a live Codex install | Linux command line with dsh 0.2.2-rc.1, including compaction and the log reducer against the real DeepSeek API; Desktop on Windows for the install and the log reducer (reported by a user); on macOS (Apple silicon and Intel) the install and the core only, not yet a dsh session |

## Install

### DeepSeek Harness

Open **Plugins → Add plugin** and enter:

```
https://github.com/ekornhq/ekorn
```

That is the whole install; it needs `git` on the machine. The plugin downloads
the core binary on first start and keeps it only if its checksum matches the
one pinned in the plugin. Details and settings: [plugins/dsh](plugins/dsh/README.md).

### Claude Code

```sh
curl -fsSL https://raw.githubusercontent.com/ekornhq/ekorn/main/install.sh | sh
```

then, inside Claude Code:

```
/plugin marketplace add ekornhq/ekorn
/plugin install ekorn@ekorn
```

Or skip the plugin and let the core edit your configuration itself: add
`-s -- --setup` after `sh` above (same as running
`~/.ekorn/bin/ekorn-core setup claude`). It writes the hooks and the
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` default into `~/.claude/settings.json`, the
token discipline into `~/.claude/CLAUDE.md` (between `<!-- ekorn:begin -->` and
`<!-- ekorn:end -->`), the `log-reducer` agent and the MCP server. Every touched
file is backed up first (`*.ekorn-bak.<timestamp>`), the command is idempotent,
and `setup claude --uninstall` removes what it added; the archive stays.

Use the plugin or `setup claude`, not both: they register the same hooks, so
installing both runs every hook twice and double-counts the ledger. The plugin
cannot set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for you; set it in `settings.json`
→ `env` if you want it (`setup claude` uses 250000). More in
[plugins/claude](plugins/claude/README.md).

### Codex CLI

Run the same `curl` line as for Claude Code, then:

```
codex plugin marketplace add ekornhq/ekorn
```

Pick ekorn under `/plugins` and trust its hooks with `/hooks`. More in
[plugins/codex](plugins/codex/README.md).

### The core binary by hand

[`install.sh`](install.sh) picks the binary for your OS and CPU (Linux and
macOS), verifies it against `sha256sums.txt`, and puts it in
`~/.ekorn/bin/ekorn-core`. It installs nothing if the checksum does not match.
`-s -- --version v0.1.0` pins a release; `EKORN_HOME` changes the target
directory. The same steps without the script:

```sh
os=$(uname -s | tr '[:upper:]' '[:lower:]'); arch=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
mkdir -p ~/.ekorn/bin && cd ~/.ekorn/bin
curl -fsSLO "https://github.com/ekornhq/ekorn/releases/latest/download/ekorn-core_${os}_${arch}"
curl -fsSLO  https://github.com/ekornhq/ekorn/releases/latest/download/sha256sums.txt
sha256sum -c --ignore-missing sha256sums.txt      # macOS: shasum -a 256 -c --ignore-missing sha256sums.txt
mv "ekorn-core_${os}_${arch}" ekorn-core && chmod +x ekorn-core
./ekorn-core --version                            # ekorn-core v0.1.0
```

Windows: download `ekorn-core_windows_amd64.exe` from
[Releases](https://github.com/ekornhq/ekorn/releases), check it against
`sha256sums.txt`, and save it as `%USERPROFILE%\.ekorn\bin\ekorn-core.exe`.

Any other location works if you point `EKORN_CORE` at the file.

### Check

```sh
~/.ekorn/bin/ekorn-core --version   # ekorn-core v0.1.0
```

A plugin's own `ekorn --version` prints that line and then
`ekorn shim 0.1.0 (…)`, which names the shell in play. Include both lines in
bug reports.

## Your data

- The archive, the ledger and the policy file live under `~/.ekorn` and nowhere
  else. The ledger is plain JSONL; it stores command shapes and byte counts,
  never tool output. Delete any of it whenever you like.
- The core binary makes no network requests.
- The only downloads are the core binary itself: by `install.sh` when you run
  it, or by the DeepSeek Harness plugin on first start (turn that off with
  `autoInstall: false`). Both fetch from this repository's Releases, verify a
  SHA-256, and send nothing about you or your sessions.

## Commands

The plugins call these for you; they are also there to use by hand.
`ekorn` below is the launcher a plugin ships, or `~/.ekorn/bin/ekorn-core`.

```
ekorn pack --run '<cmd>' [--timeout S]      # run, archive output >16 KiB, print the exact summary
ekorn pack --stdin [--label L]
ekorn recall <id> [--grep RE [-i] [-C N] | --lines A-B | --offset N] [--max-bytes N]
ekorn verify --source <file|id> --receipt <json>    # verbatim check of a log-reducer receipt
ekorn report [--days N] [--json]            # coverage, missed packs, recall rate, repeated full reads
ekorn tune [--apply ID|all | --revert ID | --history | --explain ID | --auto on|off]
ekorn probe [--days N | --since DATE] [--json | --ledger | --compare baseline.json]
ekorn setup claude [--uninstall] [--autocompact N|auto] [--claude-dir DIR] [--no-mcp] [--auto yes|no]
ekorn rules                   # print the discipline text given to the model at session start
ekorn mcp                     # stdio MCP server: edit_then_run, write_then_run, obs_recall
ekorn hook session-start | pre-tool-use | post-tool-use | pre-compact | stop
ekorn --version               # ekorn-core <version>
```

Markers in the agent's context: a packed result starts with `[ekorn-pack]`,
a recalled slice with `[ekorn-recall]`.

| | |
| --- | --- |
| `EKORN_HOME` | data directory, default `~/.ekorn` (archive, ledger, policy) |
| `EKORN_CORE` | path of the core binary; overrides `$EKORN_HOME/bin/ekorn-core` |
| `EKORN_STORE` | archive directory, if you want it elsewhere |
| `EKORN_OFF=1` | turn ekorn off for this session |
| `~/.ekorn/policy.json` | thresholds and wrap patterns; written by `ekorn tune --apply`, editable by hand (code default < policy < env) |

## This repository

ekorn is one core binary, `ekorn-core`, plus a thin shell per harness that
forwards to it. This repository holds the shells and the installer; the core is
published as a binary on [Releases](https://github.com/ekornhq/ekorn/releases)
(**v0.1.0**: linux and darwin on amd64 and arm64, windows on amd64, with
`sha256sums.txt`). The Claude Code and Codex shells do nothing without the core:
their hooks exit silently and the agent behaves as before.

```
install.sh                        core installer for Linux and macOS
plugins/claude                    Claude Code plugin (hooks, MCP, agent, skill, launcher)
plugins/codex                     Codex plugin, portable Agent Plugins layout
plugins/dsh                       DeepSeek Harness plugin (packing, compaction by cache price, log reducer)
package.json, locale/             DeepSeek Harness bundle manifest, at the root so the repository URL installs
.claude-plugin/marketplace.json   Claude Code marketplace
.agents/plugins/marketplace.json  Codex marketplace
packages/npm, pypi, crates        `ekorn` command-line launchers; not yet published to the registries
.github/workflows/publish-shims.yml
```

## License

Shells, launchers and documentation in this repository: MIT. The core binary is
distributed under its own license. The packing approach was inspired by
[NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) (MIT); this is an independent
implementation and contains none of its source.
