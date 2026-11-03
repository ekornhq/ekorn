#!/usr/bin/env node
'use strict';
// ekorn launcher. Runs the ekorn core binary when installed; otherwise hooks
// pass through unchanged and other commands explain how to install the core.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = require('../package.json').version;
const RELEASES = 'https://github.com/ekornhq/ekorn/releases';

const home = process.env.EKORN_HOME || path.join(os.homedir(), '.ekorn');
const exe = process.platform === 'win32' ? 'ekorn-core.exe' : 'ekorn-core';
const core = process.env.EKORN_CORE || path.join(home, 'bin', exe);
const args = process.argv.slice(2);

function executable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

if (executable(core)) {
  const r = spawnSync(core, args, { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

if (args[0] === 'hook') process.exit(0);
if (['--version', '-V', 'version'].includes(args[0])) {
  console.log(`ekorn shim ${VERSION} (core not installed)`);
  process.exit(0);
}

console.error(
  `ekorn: core binary not found at ${core}\n` +
    `Download it from ${RELEASES}, make it executable, and place it there, or point EKORN_CORE at it.`,
);
process.exit(2);
