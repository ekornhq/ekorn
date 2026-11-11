// Drives the plugin through a stand-in for the `tools/post-execute` waterfall.
// The core binary is replaced by a small script, so no ekorn install is needed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { decide } from './compact.js'
import { assetFor, installCore, release } from './core.js'
import * as plugin from './index.js'
import { guide } from './reducer.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-ekorn-'))
const seen = join(dir, 'seen')
const fake = join(dir, 'fake core')
writeFileSync(fake, `#!/bin/sh
printf '%s|%s' "$*" "$EKORN_STORE" > '${seen}'
n=$(wc -c)
[ "$n" -lt 200 ] && { echo small; exit 0; }
printf '[ekorn-pack] x %s bytes\\nrecall: ekorn recall obs_1 --offset 0\\n--- head ---\\nekorn recall stays\\n' "$n"
`)
chmodSync(fake, 0o755)

/** Mount the plugin and return its listener. */
function mount(config, services = {}) {
  const listeners = {}
  const warnings = []
  const infos = []
  const disposers = []
  const children = []
  const ctx = {
    on: (event, listener) => { listeners[event] = listener },
    get: service => services[service],
    plugin: child => children.push(child),
    effect: (setup) => { disposers.push(setup()) },
    logger: { warn: message => warnings.push(message), info: message => infos.push(message) },
  }
  // Compaction has its own tests below; the packer tests run without it.
  plugin.apply(ctx, { autoCompact: false, ...config })
  return { listener: listeners['tools/post-execute'], listeners, warnings, infos, disposers, children }
}

/** Serve `files` (path → bytes) on a loopback port; anything else is a 404. */
async function serve(files) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    const body = files[request.url]
    response.writeHead(body === undefined ? 404 : 200).end(body)
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return { base: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() }
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function until(condition) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(done => setTimeout(done, 10))
  assert.ok(condition(), 'timed out')
}

const text = (...parts) => parts.map(part => ({ type: 'text', text: part }))
const exec = (extra = {}) => ({ name: 'shell', callId: 'c1', signal: new AbortController().signal, ...extra })
const accept = extra => async () => ({ kind: 'accept', ...extra })
const big = 'x'.repeat(300)

test('exports the function-plugin form', () => {
  assert.equal(plugin.name, 'dsh-ekorn')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal('default' in plugin, false)
})

test('replaces large text with the summary and absolute recall commands', async () => {
  const { listener } = mount({ thresholdBytes: 100, core: fake })
  const session = { header: { id: 'se/ss:1' } }
  const decision = await listener(exec({ agent: { session } }), { content: text('a'.repeat(150), 'b'.repeat(150)) }, accept())
  assert.equal(decision.kind, 'accept')
  assert.equal(decision.content.length, 1)
  const [header, body] = decision.content[0].text.split('\n--- ')
  assert.match(header, /^\[ekorn-pack\] x 300 bytes/)
  assert.ok(header.includes(`recall: ${JSON.stringify(fake)} recall obs_1`), header)
  assert.ok(body.includes('ekorn recall stays'))
  const [args, store] = readFileSync(seen, 'utf8').split('|')
  assert.equal(args, 'pack --stdin --label shell')
  assert.match(store, /store[\\/]dsh-se_ss_1$/)
})

test('packs the content an inner listener already replaced, and keeps additionalContexts', async () => {
  const { listener } = mount({ thresholdBytes: 100, core: fake })
  const extra = [{ role: 'user' }]
  const decision = await listener(exec(), { content: text('tiny') }, accept({ content: text(big), additionalContexts: extra }))
  assert.match(decision.content[0].text, /^\[ekorn-pack\]/)
  assert.equal(decision.additionalContexts, extra)
})

test('passes through everything it should not touch', async () => {
  const { listener } = mount({ thresholdBytes: 100, core: fake })
  const same = async (execution, result, next) => {
    const inner = await next()
    assert.equal(await listener(execution, result, async () => inner), inner)
  }
  await same(exec(), { content: text('short') }, accept())
  await same(exec(), { content: text(big) }, accept({ value: { a: 1 } }))
  await same(exec(), { content: text(big) }, async () => ({ kind: 'block', feedback: text('no') }))
  await same(exec({ name: 'read' }), { content: text(big) }, accept())
  await same(exec({ parent: {} }), { content: text(big) }, accept())
  await same(exec(), { content: [...text(big), { type: 'image' }] }, accept())
  await same(exec(), { content: [] }, accept())
  await same(exec(), { content: text(`[ekorn-pack] ${big}`) }, accept())
  // Over the plugin threshold but the core declines to pack it.
  await same(exec(), { content: text('y'.repeat(150)) }, accept())
})

test('a missing core warns once and passes through', async () => {
  const { listener, warnings } = mount({ thresholdBytes: 100, core: join(dir, 'absent') })
  for (let i = 0; i < 2; i++) {
    const inner = { kind: 'accept' }
    assert.equal(await listener(exec(), { content: text(big) }, async () => inner), inner)
  }
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /ekorn-core not found/)
})

test('an aborted call passes through', async () => {
  const { listener } = mount({ thresholdBytes: 100, core: fake })
  const controller = new AbortController()
  controller.abort()
  const inner = { kind: 'accept' }
  assert.equal(await listener(exec({ signal: controller.signal }), { content: text(big) }, async () => inner), inner)
})

test('rejects bad config at load and honours EKORN_OFF', () => {
  assert.throws(() => mount({ thresholdBytes: -1 }), /thresholdBytes/)
  assert.throws(() => mount({ skipTools: 'read' }), /skipTools/)
  assert.throws(() => mount({ timeoutMs: 0 }), /timeoutMs/)
  assert.throws(() => mount({ core: '' }), /core/)
  assert.throws(() => mount({ autoInstall: 'yes' }), /autoInstall/)
  assert.throws(() => mount({ autoCompact: 1 }), /autoCompact/)
  assert.throws(() => mount({ cacheRatio: 0.5 }), /cacheRatio/)
  process.env.EKORN_OFF = '1'
  try {
    assert.equal(mount({}).listener, undefined)
  } finally {
    delete process.env.EKORN_OFF
  }
})

test('names the release file for each platform', () => {
  assert.equal(assetFor('linux', 'x64'), 'ekorn-core_linux_amd64')
  assert.equal(assetFor('darwin', 'arm64'), 'ekorn-core_darwin_arm64')
  assert.equal(assetFor('win32', 'x64'), 'ekorn-core_windows_amd64.exe')
  assert.equal(assetFor('win32', 'arm64'), undefined)
  assert.equal(assetFor('freebsd', 'x64'), undefined)
  assert.match(release.version, /^v\d+\.\d+\.\d+$/)
  for (const hash of Object.values(release.sha256)) assert.match(hash, /^[0-9a-f]{64}$/)
})

test('installCore keeps a file only when its checksum matches', async () => {
  const bytes = Buffer.from('#!/bin/sh\necho core\n')
  const server = await serve({ '/core': bytes })
  const home = mkdtempSync(join(tmpdir(), 'dsh-ekorn-core-'))
  const dest = join(home, 'bin', 'ekorn-core')
  try {
    await assert.rejects(installCore(dest, { url: `${server.base}/core`, sha256: '0'.repeat(64) }), /checksum mismatch/)
    await assert.rejects(installCore(dest, { url: `${server.base}/absent`, sha256: sha256(bytes) }), /HTTP 404/)
    assert.equal(existsSync(join(home, 'bin')), false)
    await installCore(dest, { url: `${server.base}/core`, sha256: sha256(bytes) })
    assert.deepEqual(readFileSync(dest), bytes)
    assert.equal(statSync(dest).mode & 0o111, 0o111)
    assert.deepEqual(readdirSync(join(home, 'bin')), ['ekorn-core'])
  } finally {
    server.close()
  }
})

test('a missing core is installed in the background, then used', async () => {
  const asset = assetFor()
  const core = readFileSync(fake)
  const server = await serve({ [`/v9.9.9/${asset}`]: core })
  const saved = { ...release, sha256: { ...release.sha256 }, home: process.env.EKORN_HOME }
  const home = mkdtempSync(join(tmpdir(), 'dsh-ekorn-home-'))
  Object.assign(release, { version: 'v9.9.9', url: server.base })
  release.sha256[asset] = sha256(core)
  process.env.EKORN_HOME = home
  try {
    const { listener, warnings, infos, disposers } = mount({ thresholdBytes: 100 })
    assert.equal(disposers.length, 1)
    // Until the download lands, results pass through and nothing is logged twice.
    const inner = { kind: 'accept' }
    const early = await listener(exec(), { content: text(big) }, async () => inner)
    await until(() => infos.length === 2)
    assert.match(infos[0], /downloading http:\/\/127\.0\.0\.1:\d+\/v9\.9\.9\//)
    assert.match(infos[1], /v9\.9\.9 installed/)
    assert.ok(early === inner || early.content[0].text.startsWith('[ekorn-pack]'))
    const decision = await listener(exec(), { content: text(big) }, accept())
    assert.match(decision.content[0].text, /^\[ekorn-pack\]/)
    assert.deepEqual(warnings, [])

    // A second start finds the file and asks for nothing.
    mount({ thresholdBytes: 100 })
    assert.equal(server.requests.length, 1)
  } finally {
    Object.assign(release, { version: saved.version, url: saved.url, sha256: saved.sha256 })
    if (saved.home === undefined) delete process.env.EKORN_HOME
    else process.env.EKORN_HOME = saved.home
    server.close()
  }
})

test('a failed download warns once; autoInstall: false and a named core never download', async () => {
  const server = await serve({})
  const saved = { url: release.url, home: process.env.EKORN_HOME }
  release.url = server.base
  process.env.EKORN_HOME = mkdtempSync(join(tmpdir(), 'dsh-ekorn-home-'))
  try {
    const failed = mount({ thresholdBytes: 100 })
    await until(() => failed.warnings.length === 1)
    assert.match(failed.warnings[0], /could not install ekorn-core \(HTTP 404\)/)
    const inner = { kind: 'accept' }
    assert.equal(await failed.listener(exec(), { content: text(big) }, async () => inner), inner)
    assert.equal(failed.warnings.length, 1)
    assert.equal(server.requests.length, 1)

    const off = mount({ thresholdBytes: 100, autoInstall: false })
    assert.equal(await off.listener(exec(), { content: text(big) }, async () => inner), inner)
    assert.match(off.warnings[0], /ekorn-core not found/)
    mount({ thresholdBytes: 100, core: join(dir, 'absent') })
    assert.equal(server.requests.length, 1)
  } finally {
    release.url = saved.url
    if (saved.home === undefined) delete process.env.EKORN_HOME
    else process.env.EKORN_HOME = saved.home
    server.close()
  }
})

test('decide compares the price of compacting with what it saves', () => {
  const flash = { kept: 10_000, summary: 3_000, miss: 50, output: 200 }
  // Too small to touch: under the floor, under a third of the context, or nothing to gain.
  assert.equal(decide({ ...flash, context: 200_000, requests: 500, floor: 250_000 }).compact, false)
  assert.equal(decide({ ...flash, context: 15_000, requests: 500 }).compact, false)
  assert.equal(decide({ ...flash, context: 10_000, requests: 500 }).compact, false)
  // 100K, fully cached: (100K read + 3K * 200 written + 3K * 49 read uncached) / 87K saved = 9.7 requests.
  const warm = decide({ ...flash, context: 100_000, requests: 9 })
  assert.equal(warm.compact, false)
  assert.equal(Math.round(warm.breakeven * 10), 97)
  assert.equal(decide({ ...flash, context: 100_000, requests: 10 }).compact, true)
  // Cheaper output and misses pay back sooner; a longer summary later.
  assert.ok(decide({ ...flash, miss: 30, output: 90, context: 100_000, requests: 0 }).breakeven < warm.breakeven)
  assert.ok(decide({ ...flash, summary: 10_000, context: 100_000, requests: 0 }).breakeven > 30)
  // A cache that never hits pays back at once, but never before five requests.
  const cold = decide({ ...flash, context: 100_000, requests: 4, hit: 0 })
  assert.ok(cold.breakeven < 2)
  assert.equal(cold.compact, false)
  assert.equal(decide({ ...flash, context: 100_000, requests: 5, hit: 0 }).compact, true)
})

/** A session whose requests each add `step` tokens to a fully cached context. */
function drive(mounted, { provider = 'deepseek-official', model = 'deepseek-flash' } = {}) {
  const session = { requestHeader: () => ({ config: { provider, model } }) }
  const agent = { session }
  let context = 0
  return {
    agent,
    async request(total) {
      mounted.listeners['session/event'](session, {
        type: 'assistant/message',
        data: { usage: { inputTokens: total - context, cacheReadTokens: context, outputTokens: 10 } },
      })
      context = total
      await new Promise(done => setImmediate(done)) // lets the context-window lookup settle
    },
    idle: () => mounted.listeners['agent/status']({ agent, status: 'idle' }),
    compacted(total) { context = 0; return this.request(total) },
  }
}

test('compacts at idle once the saving pays for itself, through either service', async () => {
  const calls = []
  const llm = { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) }
  const compaction = { compactNow: async (agent, signal) => { calls.push([agent, signal.aborted]); return { summarySeq: 1 } } }
  const mounted = mount({ core: fake, autoCompact: true }, { llm, compaction })
  const run = drive(mounted)
  for (let i = 1; i <= 20; i++) await run.request(10_000 + i * 10_000) // 210K after 20 requests
  mounted.listeners['agent/status']({ agent: run.agent, status: 'running' })
  run.idle()
  assert.equal(calls.length, 0) // under a quarter of the 1M window
  for (let i = 21; i <= 30; i++) await run.request(10_000 + i * 10_000) // 310K after 30
  run.idle()
  run.idle() // a second idle while the first compaction runs does nothing
  assert.deepEqual(calls, [[run.agent, false]])
  await until(() => mounted.infos.length === 1)
  assert.match(mounted.infos[0], /compacted a 310000-token context after 30 requests; expected to pay for itself in 4 \(uncached price ratio 50, cache hit share 1\.00\)/)

  // The smaller context that follows shows the size of a summary (5K here),
  // and the count of requests starts over: no second compaction right away.
  await run.compacted(25_000)
  await run.request(260_000)
  run.idle()
  assert.equal(calls.length, 1) // two requests since the compaction
  for (const total of [270_000, 280_000, 290_000]) await run.request(total)
  run.idle()
  assert.equal(calls.length, 1) // five requests; 290K with a 5K summary takes 5.8
  await run.request(300_000)
  run.idle()
  assert.equal(calls.length, 2)

  // Desktop: the service lives inside the agent's preset.
  const inner = { compactNow: async () => null }
  const presets = mount({ core: fake, autoCompact: true }, { llm, agentPresets: { serviceFor: (agent, name) => name === 'compaction' ? inner : undefined } })
  const desktop = drive(presets)
  for (let i = 1; i <= 50; i++) await desktop.request(10_000 + i * 10_000)
  let asked = 0
  inner.compactNow = async () => { asked++; return null }
  desktop.idle()
  await until(() => asked === 1)
  desktop.idle() // nothing to compact: waits for ten more requests
  assert.equal(asked, 1)
  assert.deepEqual(presets.warnings, [])
})

test('leaves unknown models and unreachable services alone', async () => {
  const llm = { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) }
  const calls = []
  const compaction = { compactNow: async () => { calls.push(1); return {} } }
  const unknown = drive(mount({ core: fake, autoCompact: true }, { llm, compaction }), { provider: 'other', model: 'm' })
  for (let i = 1; i <= 60; i++) await unknown.request(i * 10_000)
  unknown.idle()
  assert.equal(calls.length, 0)

  // cacheRatio covers a model that is not in the table.
  const named = drive(mount({ core: fake, autoCompact: true, cacheRatio: 10 }, { llm, compaction }), { provider: 'other', model: 'm' })
  for (let i = 1; i <= 60; i++) await named.request(i * 10_000)
  named.idle()
  assert.equal(calls.length, 1)

  const bare = mount({ core: fake, autoCompact: true }, { llm })
  const lone = drive(bare)
  for (let i = 1; i <= 60; i++) await lone.request(i * 10_000)
  lone.idle()
  lone.idle()
  assert.equal(bare.warnings.length, 1)
  assert.match(bare.warnings[0], /no compaction service/)

  // A failure that is not a race turns it off for the session; a race does not.
  const failing = { compactNow: async () => { throw Object.assign(new Error('boom'), { code: 'summary' }) } }
  const broken = mount({ core: fake, autoCompact: true }, { llm, compaction: failing })
  const session = drive(broken)
  for (let i = 1; i <= 60; i++) await session.request(i * 10_000)
  session.idle()
  await until(() => broken.warnings.length === 1)
  assert.match(broken.warnings[0], /failed \(boom\); off for this session/)
  let tries = 0
  failing.compactNow = async () => { tries++; throw Object.assign(new Error('busy'), { code: 'busy' }) }
  session.idle()
  assert.equal(tries, 0)
})

test('the log reducer guidance shows only where the tool is visible', () => {
  const { children } = mount({ core: fake })
  assert.equal(children.length, 1)
  assert.deepEqual(children[0].inject, ['systemPrompt', 'tools'])
  const sections = []
  const visible = new Set()
  children[0].apply({
    systemPrompt: { getSectionOrder: () => 7, section: section => sections.push(section) },
    tools: { get: (name, scope) => visible.has(scope) ? { name } : undefined },
  })
  const [section] = sections
  assert.equal(section.name, 'ekorn:log-reducer')
  assert.equal(section.order, 7)
  assert.equal(section.text({ scope: 'desktop agent' }), '')
  visible.add('cli agent')
  const text = section.text({ scope: 'cli agent' })
  assert.equal(text, guide(fake))
  assert.ok(text.includes('LOG-REDUCE source=<absolute path> question='))
  // The core path has a space in it, so the verify command quotes it.
  assert.ok(text.includes(`${JSON.stringify(fake)} verify --source`))
})
