// dsh-ekorn: ekorn plugin for DeepSeek Harness (dsh).
//
// Listens on the `tools/post-execute` waterfall. When a tool result that is
// about to reach the model is large text, the text is handed to the local
// `ekorn-core` binary, which stores it verbatim on this machine and returns an
// exact summary (head, tail, sizes, and the commands that fetch any part of it
// back). The model sees the summary; nothing leaves the machine.
//
// When no core is installed, the plugin downloads the release pinned in
// core.json once, checks its SHA-256, and puts it in ~/.ekorn/bin
// (`autoInstall: false` turns that off).
//
// Plain ESM with no dependencies and no build step, so the package installs
// the same way from npm, a git URL, or a local directory.
//
// Written against the plugin API of DeepSeek Harness 0.2.x
// (docs/subsystems/tools.md, `tools/post-execute`). That API is pre-stable.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { assetFor, defaultCorePath, ekornHome, installCore, release } from './core.js'

export const name = 'dsh-ekorn'
export const inject = ['tools']

const PACKED = '[ekorn-pack]'
const MANUAL = 'Manual install: https://github.com/ekornhq/ekorn#install'

/**
 * Environment for the core. Each dsh session gets its own archive and ledger
 * directory, as each Claude Code session does, unless EKORN_STORE is already set.
 * @param {unknown} session
 * @returns {NodeJS.ProcessEnv}
 */
function coreEnv(session) {
  if (process.env.EKORN_STORE || typeof session !== 'string' || session === '') return process.env
  return { ...process.env, EKORN_STORE: join(ekornHome(), 'store', `dsh-${session.replace(/[^A-Za-z0-9._-]/g, '_')}`) }
}

/**
 * Validate the row's config; a wrong value stops the plugin at load.
 * @param {Record<string, unknown>} config
 */
function resolve(config) {
  const { thresholdBytes = 16 * 1024, skipTools = ['read'], timeoutMs = 10_000, core, autoInstall = true } = config
  if (!Number.isSafeInteger(thresholdBytes) || thresholdBytes < 0) {
    throw new Error(`dsh-ekorn: thresholdBytes must be a non-negative integer (got ${String(thresholdBytes)})`)
  }
  if (!Array.isArray(skipTools) || skipTools.some(tool => typeof tool !== 'string')) {
    throw new Error('dsh-ekorn: skipTools must be a list of tool names')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`dsh-ekorn: timeoutMs must be a positive integer (got ${String(timeoutMs)})`)
  }
  if (core !== undefined && (typeof core !== 'string' || core === '')) {
    throw new Error('dsh-ekorn: core must be a path to the ekorn-core binary')
  }
  if (typeof autoInstall !== 'boolean') {
    throw new Error('dsh-ekorn: autoInstall must be true or false')
  }
  // A path the user named is theirs to fill; only the default location is installed into.
  const named = core ?? (process.env.EKORN_CORE || undefined)
  return {
    thresholdBytes, skip: new Set(skipTools), timeoutMs,
    core: named ?? defaultCorePath(),
    autoInstall: autoInstall && named === undefined,
  }
}

/**
 * Fetch the pinned core release into `dest` in the background. The outcome is
 * logged; until the file is there, tool results pass through unchanged.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} dest
 */
function fetchCore(ctx, dest) {
  const asset = assetFor()
  if (asset === undefined) {
    ctx.logger?.warn?.(`dsh-ekorn: no ekorn-core build for ${process.platform}/${process.arch}; tool results pass through unchanged.`)
    return
  }
  const url = `${release.url}/${release.version}/${asset}`
  const stop = new AbortController()
  ctx.effect?.(() => () => stop.abort())
  ctx.logger?.info?.(`dsh-ekorn: ekorn-core is not installed; downloading ${url} to ${dest}`)
  installCore(dest, { url, sha256: release.sha256[asset], signal: AbortSignal.any([stop.signal, AbortSignal.timeout(120_000)]) }).then(
    () => ctx.logger?.info?.(`dsh-ekorn: ekorn-core ${release.version} installed, checksum verified`),
    error => ctx.logger?.warn?.(`dsh-ekorn: could not install ekorn-core (${error?.message ?? error}); tool results pass through unchanged. ${MANUAL}`),
  )
}

/**
 * Run `ekorn-core pack --stdin`. Resolves to the summary, or undefined when
 * the core did not pack the text (too small for its own policy, a failure, a
 * timeout, or an aborted tool call).
 * @param {string} core
 * @param {string} label
 * @param {string} text
 * @param {AbortSignal | undefined} signal
 * @param {number} timeoutMs
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string | undefined>}
 */
function pack(core, label, text, signal, timeoutMs, env) {
  return new Promise((done) => {
    let child
    try {
      child = spawn(core, ['pack', '--stdin', '--label', label], {
        stdio: ['pipe', 'pipe', 'ignore'], signal, timeout: timeoutMs, env, windowsHide: true,
      })
    } catch {
      done(undefined) // spawn rejects an already-aborted signal synchronously
      return
    }
    const chunks = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.on('error', () => done(undefined))
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8')
      done(code === 0 && out.startsWith(PACKED) ? out : undefined)
    })
    child.stdin.on('error', () => {}) // the core may exit before reading everything
    child.stdin.end(text)
  })
}

/**
 * The summary names its fetch commands as `ekorn recall ...`. Inside dsh there
 * may be no `ekorn` on PATH, so point them at the binary that made the summary.
 * Only the header is touched; the quoted tool output below it stays verbatim.
 * @param {string} summary
 * @param {string} core
 * @returns {string}
 */
function absoluteRecall(summary, core) {
  const body = summary.indexOf('\n--- ')
  const header = body === -1 ? summary : summary.slice(0, body)
  const command = /\s/.test(core) ? JSON.stringify(core) : core
  return header.replaceAll('ekorn recall', `${command} recall`) + (body === -1 ? '' : summary.slice(body))
}

/**
 * Mount the packer on accepted, text-only tool results.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config] thresholdBytes, skipTools, timeoutMs, core, autoInstall
 */
export function apply(ctx, config = {}) {
  if (process.env.EKORN_OFF === '1') return
  const options = resolve(config ?? {})
  // fetchCore reports a missing core itself, so the listener stays quiet then.
  let warned = options.autoInstall
  if (options.autoInstall && !existsSync(options.core)) fetchCore(ctx, options.core)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision
    // A sub-dispatch result goes to a program, not to the model.
    if (exec.parent !== undefined || options.skip.has(exec.name)) return decision
    const content = decision.content ?? result.content
    if (content.length === 0 || !content.every(block => block.type === 'text')) return decision
    const text = content.map(block => block.text).join('')
    if (Buffer.byteLength(text, 'utf8') < options.thresholdBytes || text.startsWith(PACKED)) return decision
    if (!existsSync(options.core)) {
      if (!warned) {
        warned = true
        ctx.logger?.warn?.(`dsh-ekorn: ekorn-core not found at ${options.core}; tool results pass through unchanged. ${MANUAL}`)
      }
      return decision
    }
    const env = coreEnv(exec.agent?.session?.header?.id)
    const summary = await pack(options.core, exec.name, text, exec.signal, options.timeoutMs, env)
    if (summary === undefined) return decision
    return { ...decision, content: [{ type: 'text', text: absoluteRecall(summary, options.core) }] }
  })
}
