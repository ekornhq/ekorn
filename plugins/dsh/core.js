// Where the ekorn-core binary lives, and a one-time fetch of the pinned release
// when it is missing. The release and the expected checksums are in core.json.
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const release = JSON.parse(readFileSync(new URL('./core.json', import.meta.url), 'utf8'))

export function ekornHome() {
  return process.env.EKORN_HOME || join(homedir(), '.ekorn')
}

/** The path a default install uses: `$EKORN_HOME/bin/ekorn-core`, `.exe` on Windows. */
export function defaultCorePath() {
  return join(ekornHome(), 'bin', process.platform === 'win32' ? 'ekorn-core.exe' : 'ekorn-core')
}

/** The release file for a platform, or `undefined` when the release has none. */
export function assetFor(platform = process.platform, arch = process.arch) {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform]
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch]
  const asset = `ekorn-core_${os}_${cpu}${os === 'windows' ? '.exe' : ''}`
  return Object.hasOwn(release.sha256, asset) ? asset : undefined
}

/**
 * Download one file, check it against `sha256`, and move it to `dest` as an executable.
 * Nothing is left at `dest` unless the checksum matches.
 */
export async function installCore(dest, { url, sha256, signal }) {
  const response = await fetch(url, { redirect: 'follow', signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) throw new Error(`checksum mismatch: expected ${sha256}, got ${actual}`)
  mkdirSync(dirname(dest), { recursive: true })
  const partial = `${dest}.${process.pid}.part`
  try {
    writeFileSync(partial, bytes)
    chmodSync(partial, 0o755)
    renameSync(partial, dest)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }
}
