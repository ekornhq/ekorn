// dsh-ekorn: ekorn plugin shell for DeepSeek Harness (dsh).
//
// dsh runs every tool call through a pipeline with waterfall hooks. The one we
// need is `tools/post-execute`: it sees the finished result before it reaches
// the model and may replace the model-facing content. That is exactly where
// ekorn packs a large output (stored verbatim on disk, exact summary returned).
//
// STATUS: scaffold. The hook names and return shapes follow the official
// docs/subsystems/tools.md and docs/tool-execution-pipeline.md of
// deepseek-ai/deepseek-harness (developer preview, "there will be
// compatibility-breaking changes"). The listener registration call (`ctx.on`)
// and the exact result object layout are not yet verified against a live
// dsh install; fix them here once the core binary ships and this can be tested.

import type { Context } from '@deepseek-ai/cordis'
import { spawnSync } from 'node:child_process'

export const name = 'dsh-ekorn'
export const inject = ['tools']

export interface Config {
  /** Results smaller than this many bytes pass through untouched. */
  thresholdBytes?: number
  /** Command used to pack; defaults to the `ekorn` shim on PATH. */
  command?: string
}

export function apply(ctx: Context, config: Config = {}): void {
  const threshold = config.thresholdBytes ?? 16 * 1024
  const command = config.command ?? 'ekorn'

  if (process.env.EKORN_OFF === '1') return

  // Waterfall: return `next()` to leave the result alone, or an `accept`
  // outcome with replacement content.
  ;(ctx as any).on(
    'tools/post-execute',
    async (exec: any, result: any, next: () => Promise<unknown>) => {
      const text = extractText(result)
      if (text === undefined || Buffer.byteLength(text, 'utf8') < threshold) return next()
      const packed = pack(command, String(exec?.name ?? 'tool'), text)
      if (packed === undefined) return next()
      return { kind: 'accept', content: [{ type: 'text', text: packed }] }
    },
  )
}

/** Pull the model-facing text out of a tool result, tolerating a few shapes. */
function extractText(result: any): string | undefined {
  if (result == null) return undefined
  if (typeof result === 'string') return result
  const content = result.content ?? result.value
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content.filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    if (parts.length !== content.length) return undefined // mixed content: leave alone
    return parts.map((c) => c.text).join('')
  }
  return undefined
}

/** Run `ekorn pack --stdin --label <label>`; undefined when the core is absent. */
function pack(command: string, label: string, text: string): string | undefined {
  const r = spawnSync(command, ['pack', '--stdin', '--label', label], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.error || r.status !== 0 || !r.stdout) return undefined
  return r.stdout
}
