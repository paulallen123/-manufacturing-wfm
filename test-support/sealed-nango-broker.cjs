'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { after } = require('node:test');
const HASHES = {
  'provider-metadata-broker.cjs': '746ee6571853be4395f48fcf2826b110caa27cacc6261bd82731e7a6534aa5d1',
  'provider-metadata-evidence.cjs': 'e3b08bd80464689ea5d783cbc4dc261d8db8c1ebb48936d84fb2f591e846bd41',
  'provider-live-acceptance.cjs': 'adad42fbb4e9a216450953174e14d99a0bf8bc57d9a2c792c00b3507ee88eb06'
};
const digest = value => createHash('sha256').update(value).digest('hex');
function loadLibrary() {
  let lib = process.env.VECTOR_NANGO_BROKER_ROOT;
  if (!lib) {
    const archive = process.env.VECTOR_TEST_ARCHIVE || path.resolve(__dirname, '../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
    const bytes = fs.readFileSync(archive);
    if (digest(bytes) !== '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d') throw Error('NANGO_TEST_ARCHIVE_DRIFT');
    const directory = fs.mkdtempSync(path.join(__dirname, '.nango-broker-'));
    after(() => fs.rmSync(directory, { recursive: true, force: true }));
    // This exact hash-bound archive has 138 regular entries. No subprocess is needed.
    const tar = gunzipSync(bytes, { maxOutputLength: 3 * 1024 * 1024 }), seen = new Set();
    for (let at = 0; at + 512 <= tar.length && tar[at] !== 0;) {
      const header = tar.subarray(at, at + 512);
      const field = (start, end) => header.toString('utf8', start, end).split('\0')[0].trim();
      const prefix = field(345, 500), name = (prefix ? prefix + '/' : '') + field(0, 100);
      const size = Number.parseInt(field(124, 136), 8);
      if (header[156] === 120 && /^\d+ mtime=\d+(?:\.\d+)?\n$/.test(tar.toString('utf8', at + 512, at + 512 + size))) {
        at += 512 + Math.ceil(size / 512) * 512; continue;
      }
      if (header[156] !== 48 || !name || path.isAbsolute(name) || name.split('/').includes('..') || seen.has(name) ||
          !Number.isSafeInteger(size) || size < 0 || at + 512 + size > tar.length) throw Error('NANGO_TEST_ARCHIVE_FORMAT');
      seen.add(name);
      const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, tar.subarray(at + 512, at + 512 + size));
      at += 512 + Math.ceil(size / 512) * 512;
    }
    if (seen.size !== 138) throw Error('NANGO_TEST_ARCHIVE_COVERAGE');
    lib = path.join(directory, 'lib');
  }
  for (const [name, expected] of Object.entries(HASHES)) if (digest(fs.readFileSync(path.join(lib, name))) !== expected) throw Error('NANGO_TEST_BROKER_SOURCE_DRIFT');
  return lib;
}
function loadBroker() { return require(path.join(loadLibrary(), 'provider-metadata-broker.cjs')); }
module.exports = { loadBroker, loadLibrary };
