# ekorn

Lossless, recallable tool-output packing for coding agents.

This package is the `ekorn` command-line launcher. It runs the ekorn core
binary (`~/.ekorn/bin/ekorn-core`, or `EKORN_CORE`) and is what the Claude
Code, Codex and DeepSeek Harness plugin shells call.

```
npm i -g ekorn
ekorn --version
```

`ekorn --version` prints two lines: the core's own version (`ekorn-core v0.1.0`,
or a note that it is not installed) and the launcher's (`ekorn shim 0.1.0`).
Without the core, `ekorn hook ...` is a silent no-op and every other command
prints where to get it. The core itself (static binary, five platforms,
`sha256sums.txt`) is on https://github.com/ekornhq/ekorn/releases; install
steps and the plugin shells are in the project README:
https://github.com/ekornhq/ekorn
