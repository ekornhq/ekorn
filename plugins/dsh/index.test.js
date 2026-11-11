// Drives the plugin through a stand-in for the `tools/post-execute` waterfall.
// The core binary is replaced by a small script, so no ekorn install is needed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assetFor, installCore, release } from './core.js'
import * as plugin from './index.js'

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
function mount(config) {
  const listeners = []
  const warnings = []
  const infos = []
  const disposers = []
  const ctx = {
    on: (event, listener) => { assert.equal(event, 'tools/post-execute'); listeners.push(listener) },
    effect: (setup) => { disposers.push(setup()) },
    logger: { warn: message => warnings.push(message), info: message => infos.push(message) },
  }
  plugin.apply(ctx, config)
  return { listener: listeners[0], warnings, infos, disposers }
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
