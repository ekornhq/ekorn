// Compaction by cache economics.
//
// An agent re-sends its whole context with every request. Cached input is
// cheap, so a long context costs little per request, but it is paid on every
// request for the rest of the session. Compacting stops that, at a price: one
// request that reads the context and writes a summary. This module compares
// the two from the session's own token counts and compacts, when the agent
// goes idle, once the saving is expected to pay for itself.
//
// The compaction is dsh's manual one (`compactNow`, what `/compact` runs). It
// folds everything after the system prompt into the summary and keeps nothing
// word for word, so it is never run on a context below a share of the model's
// window, whatever the prices say.
//
// dsh's own threshold (a larger share of the window) keeps working; this only
// adds an earlier, price-based trigger.

/**
 * Prices in units of one cached input token: `miss` is an uncached input
 * token, `output` an output token.
 * Source: https://api-docs.deepseek.com/quick_start/pricing, read 2026-11-11
 * (per 1M tokens, flash $0.003 cached / $0.15 uncached / $0.6 output, pro
 * $0.022 / $0.66 / $1.98; peak hours double all of them, so the ratios hold).
 * A model that is not listed is left to dsh's own threshold unless
 * `cacheRatio` is set.
 */
export const PRICE = {
  'deepseek-official/deepseek-flash': { miss: 50, output: 200 },
  'deepseek-official/deepseek-v4-pro': { miss: 30, output: 90 },
}

const MIN_REQUESTS = 5
// Size of a summary until a compaction shows a real one.
const SUMMARY_TOKENS = 3000
const PREFIX_CAP = 20_000
// Never compact a context smaller than this share of the model's window.
const FLOOR_SHARE = 0.25
// Output price over uncached input price, for a model known only by `cacheRatio`.
const OUTPUT_PER_MISS = 4

/**
 * Decide whether compacting now is expected to pay for itself.
 *
 * Costs are counted in cached-token prices. `hit` is the share of the previous
 * request that the provider served from its cache; a replayed token then costs
 * `hit + (1 - hit) * miss`. Compacting costs one request that reads the current
 * context and writes the summary, and the summary is read uncached once on the
 * request after it. It saves `context - kept - summary` replayed tokens on
 * every later request. The session is assumed to make about as many more
 * requests as it has made since it started or was last compacted.
 *
 * @param {{ context: number, kept: number, summary: number, requests: number, miss: number, output: number, hit?: number, floor?: number }} input
 *   `context`: tokens now; `kept`: tokens a compaction leaves as they are (system
 *   prompt and tools); `summary`: tokens of the summary; `requests`: requests
 *   since the start or the last compaction; `floor`: smallest context to compact
 * @returns {{ compact: boolean, breakeven?: number, saving?: number }}
 */
export function decide({ context, kept, summary, requests, miss, output, hit = 1, floor = 0 }) {
  const saving = context - kept - summary
  // Not worth losing detail for a small context, or for less than a third of it.
  if (context < floor || !(saving > 0) || saving * 3 < context) return { compact: false }
  const replay = hit + (1 - hit) * miss
  const cost = context * replay + summary * output + summary * (miss - replay)
  const breakeven = cost / (saving * replay)
  return { compact: requests >= Math.max(MIN_REQUESTS, breakeven), breakeven, saving }
}

/**
 * Follow each session's token use and compact when {@link decide} says so.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ cacheRatio?: number }} options
 */
export function autoCompact(ctx, options) {
  /** @type {WeakMap<object, { requests: number, prev: number, prefix?: number, summary?: number, hit?: number, busy?: boolean, off?: boolean, wait?: number, route?: string }>} */
  const sessions = new WeakMap()
  /** @type {Map<string, number | undefined>} context window per route */
  const windows = new Map()
  const stop = new AbortController()
  ctx.effect?.(() => () => stop.abort())
  let noService = false

  const learnWindow = (session, state) => {
    const config = session.requestHeader?.()?.config
    if (typeof config?.provider !== 'string' || typeof config?.model !== 'string') return
    state.route = `${config.provider}/${config.model}`
    if (windows.has(state.route)) return
    windows.set(state.route, undefined)
    Promise.resolve(ctx.get?.('llm')?.resolveModelInfo?.(config.provider, config.model, stop.signal)).then(
      info => windows.set(state.route, info?.context?.contextWindow),
      () => {},
    )
  }

  ctx.on('session/event', (session, event) => {
    const usage = event?.type === 'assistant/message' ? event.data?.usage : undefined
    if (usage === undefined || typeof session !== 'object' || session === null) return
    const read = usage.cacheReadTokens ?? 0
    const prompt = (usage.inputTokens ?? 0) + read + (usage.cacheWriteTokens ?? 0)
    if (!(prompt > 0)) return
    let state = sessions.get(session)
    if (state === undefined) sessions.set(session, state = { requests: 0, prev: 0 })
    state.requests++
    state.prefix ??= Math.min(prompt, PREFIX_CAP)
    if (state.prev > 0 && prompt < state.prev * 0.7) {
      // The context shrank: a compaction or a clear. What it left beyond the
      // prefix is the size of a summary, and the count of requests starts over.
      state.summary = Math.max(0, prompt - state.prefix)
      state.requests = 1
      state.wait = undefined
    } else if (state.prev > 0) {
      const sample = Math.min(1, read / state.prev)
      state.hit = state.hit === undefined ? sample : 0.7 * state.hit + 0.3 * sample
    }
    state.prev = prompt
    learnWindow(session, state)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const session = agent?.session
    const state = session && sessions.get(session)
    if (!state || state.busy || state.off || state.requests < (state.wait ?? 0)) return
    const price = options.cacheRatio === undefined
      ? PRICE[state.route]
      : { miss: options.cacheRatio, output: options.cacheRatio * OUTPUT_PER_MISS }
    const window = windows.get(state.route)
    if (price === undefined || window === undefined) return
    const verdict = decide({
      context: state.prev,
      kept: state.prefix,
      summary: state.summary ?? SUMMARY_TOKENS,
      requests: state.requests,
      miss: price.miss,
      output: price.output,
      hit: state.hit ?? 1,
      floor: window * FLOOR_SHARE,
    })
    if (!verdict.compact) return
    // Desktop keeps the compaction service inside each agent's preset; the CLI has one for all.
    const service = ctx.get?.('agentPresets')?.serviceFor?.(agent, 'compaction') ?? ctx.get?.('compaction')
    if (typeof service?.compactNow !== 'function') {
      if (!noService) ctx.logger?.warn?.('dsh-ekorn: no compaction service to call; automatic compaction is off.')
      noService = true
      return
    }
    const before = state.prev
    const requests = state.requests
    state.busy = true
    let run
    try { run = Promise.resolve(service.compactNow(agent, stop.signal)) } catch (error) { run = Promise.reject(error) }
    run.then((result) => {
      // Nothing useful to compact right now: look again after ten more requests.
      if (result == null) { state.wait = state.requests + 10; return }
      ctx.logger?.info?.(
        `dsh-ekorn: compacted a ${before}-token context after ${requests} requests; `
        + `expected to pay for itself in ${Math.ceil(verdict.breakeven)} `
        + `(uncached price ratio ${price.miss}, cache hit share ${(state.hit ?? 1).toFixed(2)})`,
      )
    }, (error) => {
      // `busy`, `cancelled` and `changed` are ordinary races with the user; try again at the next idle.
      if (['busy', 'cancelled', 'changed'].includes(error?.code)) return
      state.off = true
      ctx.logger?.warn?.(`dsh-ekorn: automatic compaction failed (${error?.message ?? error}); off for this session.`)
    }).finally(() => { state.busy = false })
  })
}
