# dsh-ekorn

ekorn for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), CLI and Desktop.

When a tool returns a large text result, the full output is stored on your
machine and the model sees an exact summary: sizes, the first and last lines,
and the commands that fetch any part of it back. Nothing leaves the machine.

## Install

**1. The core binary** (once per machine; Linux and macOS):

```sh
curl -fsSL https://raw.githubusercontent.com/ekornhq/ekorn/main/install.sh | sh
```

Windows: see the [project README](https://github.com/ekornhq/ekorn#install).
Without the core the plugin does nothing: tool results pass through unchanged
and one warning is logged.

**2. The plugin.** In Desktop or Web open **Plugins → Add plugin** and enter one
of these; on the command line pass the same text to
`dsh plugin --profile <name> add`:

| Source | What to enter |
| --- | --- |
| GitHub | `git+https://github.com/ekornhq/ekorn.git#main&path:/plugins/dsh` |
| Local checkout | the absolute path of this directory, e.g. `/home/you/ekorn/plugins/dsh` |
| npm | `dsh-ekorn` (once it is published) |

Replace `main` with a commit hash to pin what you run. The plugin is plain
JavaScript with no dependencies and no build step, so a git install needs no
build-script permission.

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

The core is looked up as `core`, then `$EKORN_CORE`, then
`$EKORN_HOME/bin/ekorn-core` (default `~/.ekorn/bin/ekorn-core`).
`EKORN_OFF=1` in dsh's environment disables the plugin.

A patch replaces the row's whole `config`, so list every key you want to keep.

## Remove

Uninstall it on the Plugins page, or `dsh plugin --profile <name> remove dsh-ekorn`.
The archive under `~/.ekorn` stays.

## Status

Written against the plugin API of DeepSeek Harness 0.2.x, which is pre-stable.
Checked with dsh 0.2.2-rc.1: the package installs as a bundle from a local
directory and from the git URL above, and its layer appears in
`--dump-config`. `npm test` covers the listener against a stand-in for the
waterfall.
