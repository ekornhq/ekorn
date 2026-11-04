# ekorn for DeepSeek Harness (dsh)

Plugin shell packaged the way dsh expects: an npm package whose `package.json`
declares `dsh.bundle`, plus a `cordis.patch.yml` that inserts the plugin row.

```
dsh plugin --profile web add dsh-ekorn        # once published to npm
dsh --profile web --dump-config               # confirm the ekorn row is present
```

How it works: dsh has no PreToolUse-style input rewriting, but its
`tools/post-execute` waterfall hook may replace the model-facing content of a
finished tool call. The plugin pipes any result larger than `thresholdBytes`
(default 16 KiB) through `ekorn pack --stdin`, so the model receives the exact
summary and the full output stays on disk for `ekorn recall`.

Requirements:

- `ekorn` on `PATH` (`npm i -g ekorn`, `pipx install ekorn` or `cargo install ekorn`)
  and the core binary (v0.1.0 or later, see the
  [install steps](../../README.md#install)) at `~/.ekorn/bin/ekorn-core`.
  Without them every result passes through unchanged. `ekorn --version` prints
  the core line, then the launcher line.
- Build before publishing: `npm install && npm run build` (outputs `lib/`).

Status: scaffold, not yet published or run against a live dsh. The hook name
and return shape follow the official tools subsystem docs; the registration
call is marked in `src/index.ts` as the thing to verify first. The usage ledger
(`ekorn report` / `ekorn tune`) only covers harnesses with PostToolUse-style
hooks, so it stays empty under dsh.
