# dsh-ekorn

ekorn for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), CLI and Desktop.

When a tool returns a large text result, the full output is stored on your
machine and the model sees an exact summary: sizes, the first and last lines,
and the commands that fetch any part of it back. Nothing leaves the machine.

It also compacts a long session when the model's cache prices say that will pay
for itself; see [Automatic compaction](#automatic-compaction). And it adds a
`log_reducer` sub-agent that reads long logs on the cheaper model; see
[Log reducer](#log-reducer).

## Install

In Desktop or Web open **Plugins → Add plugin** and enter:

```
https://github.com/ekornhq/ekorn
```

That is the whole install. On the command line:
`dsh plugin --profile <name> add https://github.com/ekornhq/ekorn`.

Other sources work too:

| Source | What to enter |
| --- | --- |
| A pinned commit | `https://github.com/ekornhq/ekorn#<commit hash>` |
| Local checkout | the absolute path of the repository root, e.g. `/home/you/ekorn` |
| npm | `dsh-ekorn` (once it is published) |

Installing from a GitHub address needs `git` on the machine; dsh reports a
failed install without it. The plugin is plain JavaScript with no dependencies
and no build step, so a git install needs no build-script permission.

### The core binary

The plugin works through the `ekorn-core` binary. If none is installed, the
plugin downloads one when dsh starts: the release named in
[`core.json`](core.json), from this project's GitHub Releases, into
`~/.ekorn/bin`. The file is kept only if its SHA-256 equals the value in
`core.json`, so a given plugin version always runs the same binary. The
download is the plugin's only network request; it sends nothing about you or
your sessions. Both outcomes are written to the dsh log.

Until the binary is there (or if the download fails, for example without access
to GitHub), tool results pass through unchanged. To install it yourself, or to
keep the plugin offline, follow the
[project README](https://github.com/ekornhq/ekorn#install) and set
`autoInstall: false` (see Settings). A core you already installed is used as it
is and never replaced.

Check that the layer is active:

```sh
dsh --profile <name> --dump-config | grep -A2 'dsh-ekorn'
```

## What it does to a tool result

It listens on the `tools/post-execute` waterfall and replaces the model-facing
text only when all of these hold:

- the result was accepted and is text only (results with images, structured
  values, and blocked results are left alone);
- the text is at least `thresholdBytes` long and the core decides to pack it;
- the tool is not in `skipTools`, and the call is not a sub-dispatch from a
  program (`exec.parent`).

Anything else, including a missing core, a timeout or a cancelled call, passes
through unchanged. dsh's own output limit (`spill-policy`) runs after this
plugin and sees the summary.

Each dsh session gets its own archive and ledger under
`~/.ekorn/store/dsh-<session id>`, so `ekorn-core report` and `ekorn-core tune`
cover dsh sessions too. The summary names the fetch commands with the full path
of the core binary, so the model can run them from the shell tool without
`ekorn` on `PATH`.

## Automatic compaction

An agent re-sends its whole context with every request. Cached input is cheap,
so a long context costs little per request, but it is paid again on every
request until the session ends. dsh compacts on its own only when the context
nears the model's window (80% by default, about 800K tokens on a 1M-token
model). This plugin adds an earlier trigger based on price, with nothing to
set up.

When the agent goes idle, the plugin compares, from the session's own token
counts:

- **what compacting costs**: one request that reads the whole context and
  writes the summary, and the summary read once at the uncached price on the
  request after it;
- **what it saves**: the tokens removed, on every later request, at the price
  those tokens were really paying (cached, as far as the provider's cache has
  been hitting in this session).

It compacts when the session has made at least as many requests, since it
started or was last compacted, as the saving needs to pay the cost back. The
assumption is that it will make about as many again. It never compacts before
five requests.

The compaction is dsh's own, the one `/compact` runs. It folds the whole
conversation into a summary and keeps nothing word for word; only the system
prompt and the tools stay as they are. (dsh's threshold compaction keeps the
most recent part; the one a plugin can call does not.) Detail is lost, so the
plugin never compacts a context smaller than a quarter of the model's window,
250K tokens on a 1M-token model, whatever the prices say. Each compaction is
written to the dsh log with the numbers behind it.

On DeepSeek's prices the cost is paid back within a few requests for any
context above that floor: on `deepseek-flash`, with every request served from
the cache and a 3,000-token summary, a 300K-token context pays back in 4
requests. So in practice the rule is: more than a quarter of the window, at
least five requests since the last compaction, and the agent idle. The money
saved per request is small, because cached input is cheap: 300K cached tokens
cost $0.0009 a request on `deepseek-flash` and $0.0066 on `deepseek-v4-pro`.

The prices are built in for `deepseek-flash` (uncached input 50 times cached,
output 200 times) and `deepseek-v4-pro` (30 and 90), from the
[DeepSeek price list](https://api-docs.deepseek.com/quick_start/pricing) as
read on 2026-11-11. Peak hours double every price, so the ratios hold. For any
other model the plugin does nothing here and dsh's own threshold applies,
unless you give the uncached ratio in `cacheRatio`; output is then taken as
four times the uncached price.

Until a session has been compacted once, the summary is taken as 3,000 tokens.
After that the plugin uses the size it saw.

## Log reducer

The bundle layer adds a tool named `log_reducer`. It is dsh's own sub-agent
tool, fixed to `deepseek-flash`, whatever model the session itself runs on.
When a log, a test output or a large file matters for only a few of its lines,
the model hands the path and its question to `log_reducer`. The sub-agent reads
the file in its own context, so the full text never enters the main
conversation, and answers with quotes copied word for word from the source.
Before it answers it must pass `ekorn-core verify`, which rejects any quote
that is not in the file.

The plugin adds the instructions for both sides to the system prompt, and only
for agents that can see the tool.

The sub-agent's answer reaches the session by itself when the sub-agent
finishes. The plugin refuses the calls that get in the way of that: a message
from the reducer to the session (dsh wakes the session for the message and
again for the finish, so it answers twice), and the session polling, messaging
or stopping a reducer it started. Each refusal tells the model to end its turn.

On a session that already runs on `deepseek-flash` the price per token is the
same; what is saved is the main conversation's context. The model is given
without a provider, so the sub-agent uses the session's provider: with a
provider that has no `deepseek-flash`, the call returns an error. To use
another model, or to remove the tool, restate the row:

```yaml
- id: ekorn-log-reducer
  config:
    provider: spawn
    toolName: log_reducer
    agentOptions:
      model: <model id>
# or, to remove it:
- id: ekorn-log-reducer
  disabled: true
```

## Settings

Defaults live in the plugin. To change one, restate the row in the profile's
`cordis.patch.yml` (`~/.dsh/profiles/<name>/cordis.patch.yml`):

```yaml
- id: ekorn
  config:
    thresholdBytes: 32768
    skipTools: [read]
```

| Key | Default | Meaning |
| --- | --- | --- |
| `thresholdBytes` | `16384` | Results shorter than this many bytes are never sent to the core. |
| `skipTools` | `[read]` | Tool names whose results are never packed. `read` pages files itself. |
| `timeoutMs` | `10000` | Time allowed for one pack; after it the result passes through. |
| `core` | see below | Path of the `ekorn-core` binary. |
| `autoInstall` | `true` | Download the core when it is missing. Applies only to the default path. |
| `autoCompact` | `true` | Compact when the cache prices say it pays off. `false` leaves compaction to dsh. |
| `cacheRatio` | built in | Uncached input price divided by cached input price, for a model that is not built in. |

The core is looked up as `core`, then `$EKORN_CORE`, then
`$EKORN_HOME/bin/ekorn-core` (default `~/.ekorn/bin/ekorn-core`). A path you
name with `core` or `$EKORN_CORE` is never downloaded into.
`EKORN_OFF=1` in dsh's environment disables the plugin.

A patch replaces the row's whole `config`, so list every key you want to keep.

## Remove

Uninstall it on the Plugins page, or `dsh plugin --profile <name> remove dsh-ekorn`.
The archive under `~/.ekorn` stays.

## Status

Written against the plugin API of DeepSeek Harness 0.2.x, which is pre-stable.

Checked with dsh 0.2.2-rc.1 on Linux, command-line (`headless`) profile:

- the package installs as a bundle from a local directory, from its packed
  tarball and from the repository URL; its layer appears in `--dump-config`;
- the core download, checksum, pack and recall run against the real release;
- against the real DeepSeek API (2026-11-11):
  - log reducer: a session on `deepseek-v4-pro`, given a 6,000-line build log
    (220 KB) and asked why the build failed, called `log_reducer` without
    being told to. The sub-agent ran on `deepseek-flash`, wrote a receipt,
    passed `ekorn-core verify`, and the session named the right error. The
    session stayed under 10K tokens and the sub-agent under 14K;
  - compaction: a `deepseek-flash` session grew to 314K tokens over 32
    requests, each served from the cache almost entirely, and was compacted
    when the turn ended, well below dsh's own threshold (800K). The summary
    request read the 314K tokens at the cached price, and the next request of
    the resumed session carried 3 messages and 7.4K tokens;
  - the control: the same kind of session, grown to 517K tokens, with
    `autoCompact: false`. No compaction request was sent, and the resumed
    session carried all 103 messages and 517K tokens. With the plugin's
    compaction on it carried 3 messages and 6.8K tokens;
  - a session of three turns, each a separate dsh process, 517K tokens after
    the second: compacted after the second turn, and the third started from 3
    messages and 6.9K tokens. Nothing of the earlier turns was kept word for
    word.

  The 314K run used the trigger rule as it is now. The control and the
  three-turn run used an earlier version of it, which would not have compacted
  at 314K; what they show about dsh's compaction itself still holds.

In the earlier of those runs the main model sometimes polled the sub-agent, and
the sub-agent sometimes sent its answer as a message before finishing, which
made the session answer twice. The plugin now refuses both calls. In the two
runs after that change the session answered once; in one of them both refusals
fired (the session's `job_output`, the reducer's `send_message`) and both
models then did as told. Still possible: the main model searching the log
itself while it waits, seen in two of the three runs before the change and in
neither after.

On Windows, in Desktop (reported by a user, 2026-11-11, before that change):
the plugin installs from the repository URL, and a session given a 6,000-line
log called `log_reducer` without being told to, waited for it, and named the
right error from the two quotes of the receipt. It then answered a second
time, which is what the refusals are for. Not looked at there: which model the
sub-agent ran on.

Not yet checked: automatic compaction in Desktop; the refusals in Desktop;
macOS; a provider other than DeepSeek.

`npm test` (from the repository root) covers the packer, the compaction
decision, the reducer guidance and the refusals against stand-ins.
