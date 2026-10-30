'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(process.env.V080_SOURCE || path.join(__dirname, 'vector-reporting-ui.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'expected shipped function boundaries');
  return source.slice(a, b);
}
const functions = [
  section('function valueAt(', 'function cell(v){'),
  section('function calculateRow(', 'async function run(){'),
  section('async function run(){', 'async function save(){'),
  section('function csv(){', 'function printReport(){')
].join('\n');

// Exercise the shipped run/error path and CSV consumer together. Only the
// source HTTP response and browser primitives are synthetic collaborators.
async function runAndExport(body, priorBody = null, recalcAfter = false) {
  let blobs = 0, downloads = 0, csv = null;
  const main = { innerHTML: '' };
  const state = {
    selectedSource: { id: 'weekly-review', endpoint: '/api/fixture-source' },
    loading: false, baseRows: [], rows: [], columns: [], calculations: [], filters: [], sorts: []
  };
  class Blob {
    constructor(parts) { blobs++; csv = parts.join(''); }
  }
  const responses = priorBody ? [priorBody, body] : [body];
  const context = {
    state, body, hasPrior: Boolean(priorBody), recalcAfter, Blob, JSON, Number, String, Date,
    json: async url => { assert.equal(url, '/api/fixture-source'); return responses.shift(); },
    renderReport() {}, modal: () => ({ querySelector: () => main }),
    esc: value => String(value),
    loadCatalog() { assert.fail('mapping failure must not be mistaken for authority denial'); },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    document: { createElement: () => ({ click() { downloads++; } }) },
    setTimeout(callback) { callback(); }, toast() {}
  };
  await vm.runInNewContext(functions + '\n(async()=>{if(hasPrior)await run();await run();if(recalcAfter)recalc();csv();})()', context);
  return { rows: JSON.parse(JSON.stringify(state.rows)), baseRows: JSON.parse(JSON.stringify(state.baseRows)), columns: JSON.parse(JSON.stringify(state.columns)), raw: state.raw, error: main.innerHTML, blobs, downloads, csv };
}

test('ambiguous flat/nested fields refuse the report before any Blob or download', async () => {
  for (const row of [
    { 'p.x': 'direct', p: { x: 'nested' } },
    { p: { x: 'nested' }, 'p.x': 'direct' },
    { 'p.x': 'same', p: { x: 'same' } },
    { 'p.x': null, p: { x: [] } },
    { outer: { 'p.x': 'direct', p: { x: 'nested' } } }
  ]) {
    const result = await runAndExport({ rows: [row] });
    assert.deepEqual(result.rows, [], 'no precedence or partial result may be selected');
    assert.match(result.raw.error, /Ambiguous report source fields/);
    assert.equal(result.blobs, 0);
    assert.equal(result.downloads, 0);
  }
});

test('a collision in a later row refuses the whole result before CSV materialization', async () => {
  const result = await runAndExport({ rows: [{ 'p.x': 'valid' }, { 'p.x': 'direct', p: { x: 'nested' } }] });
  assert.deepEqual(result.rows, []);
  assert.match(result.error, /Source could not be read/);
  assert.equal(result.blobs, 0);
  assert.equal(result.downloads, 0);
});

test('a refused later run cannot replay earlier source rows through recalc and CSV', async () => {
  const result = await runAndExport(
    { rows: [{ 'p.x': 'direct', p: { x: 'nested' } }] },
    { rows: [{ team: 'PREVIOUS SOURCE ROW' }] },
    true
  );
  assert.deepEqual(result.rows, [], 'recalc must not restore stale rows');
  assert.deepEqual(result.baseRows, [], 'no cached source rows survive a refused run');
  assert.deepEqual(result.columns, [], 'old columns must not describe a later source');
  assert.match(result.raw.error, /Ambiguous report source fields/);
  assert.equal(result.blobs, 0);
  assert.equal(result.downloads, 0);
});

test('ordinary nested rows and own special JSON keys retain the reviewed mapping', async () => {
  const rows = JSON.parse('[{"id":"A","details":{"__proto__":"literal1","count":0},"skills":["a","b"]},{"id":"B","details":{"__proto__":"literal2","count":4},"skills":[]}]');
  const result = await runAndExport({ rows });
  assert.deepEqual(result.rows, [
    { id: 'A', 'details.__proto__': 'literal1', 'details.count': 0, skills: 2 },
    { id: 'B', 'details.__proto__': 'literal2', 'details.count': 4, skills: 0 }
  ]);
  assert.equal(result.blobs, 1);
  assert.equal(result.downloads, 1);
  assert.match(result.csv, /literal1/);
  assert.match(result.csv, /literal2/);
});

test('the same column in separate rows and an unambiguous dotted field remain available', async () => {
  const result = await runAndExport({ rows: [{ 'p.x': 'first', flag: false }, { 'p.x': 'second', flag: true }] });
  assert.deepEqual(result.rows, [{ 'p.x': 'first', flag: false }, { 'p.x': 'second', flag: true }]);
  assert.equal(result.blobs, 1);
  assert.equal(result.downloads, 1);
});
