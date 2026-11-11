// Drives the plugin through a stand-in for the `tools/post-execute` waterfall.
// The core binary is replaced by a small script, so no ekorn install is needed.
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
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
  const ctx = {
    on: (event, listener) => { assert.equal(event, 'tools/post-execute'); listeners.push(listener) },
    logger: { warn: message => warnings.push(message) },
  }
  plugin.apply(ctx, config)
  return { listener: listeners[0], warnings }
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
  process.env.EKORN_OFF = '1'
  try {
    assert.equal(mount({}).listener, undefined)
  } finally {
    delete process.env.EKORN_OFF
  }
})
