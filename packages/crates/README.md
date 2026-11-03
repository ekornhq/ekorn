# ekorn

Lossless, recallable tool-output packing for coding agents.

This crate is the `ekorn` command-line launcher. It runs the ekorn core
binary (`~/.ekorn/bin/ekorn-core`, or `EKORN_CORE`) and is what the Claude
Code, Codex and DeepSeek Harness plugin shells call.

```
cargo install ekorn
ekorn --version
```

Pre-release: the core binary is not published yet. Until it is, `ekorn hook ...`
is a no-op and other commands print where to get the core.
Project: https://github.com/ekornhq/ekorn
