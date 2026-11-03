# ekorn

Lossless, recallable tool-output packing for coding agents.

Large command outputs are stored verbatim on your machine and replaced in the
agent's context by a short, exact summary. Anything the agent needs later can be
recalled line-by-line. Nothing leaves your machine.

ekorn 把编码代理里的大输出原样存在本机、只给模型看精确摘要，需要时逐行取回。
数据不出你的机器。

## Status

Pre-release. Plugin shims for Claude Code, Codex CLI and DeepSeek Harness will
live in this repository; the core ships as a single static binary under
[Releases](https://github.com/ekornhq/ekorn/releases).

## License

Shims and documentation in this repository: MIT. The core binary is distributed
under its own license. The packing approach was inspired by
[NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi) (MIT); this is an independent
implementation and contains none of its source.
