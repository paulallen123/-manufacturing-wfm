'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(process.env.V080_SOURCE || path.join(__dirname, 'vector-reporting-ui.js'), 'utf8');
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'source boundaries must match');
  return source.slice(a, b);
}
const functions = [
  slice('function valueAt(', 'function cell(v){'),
  slice('function calculateRow(', 'function recalc()'),
  slice('function csv(){', 'function printReport(){')
].join('\n');

function exercise(body, selectedSource = 'weekly-review') {
  let blob, downloaded, notice;
  class Blob { constructor(parts, options) { blob = { text: parts.join(''), type: options.type }; } }
  const state = { rows: [], columns: [], calculations: [], filters: [], sorts: [] };
  const context = {
    state, input: JSON.parse(JSON.stringify(body)), sourceId: selectedSource, Blob, JSON, Number, String, Date,
    URL: { createObjectURL() { return 'blob:fixture'; }, revokeObjectURL() {} },
    document: { createElement() { return { click() { downloaded = this.download; } }; } },
    setTimeout(callback) { callback(); }, toast(value) { notice = value; }
  };
  vm.runInNewContext(functions + "\nstate.rows=applyControls(rowsFor(sourceId,input));csv();", context);
  return { rows: JSON.parse(JSON.stringify(state.rows)), blob, downloaded, notice };
}
test('multiple rows keep a stable schema and primitive values before export', () => {
  const input = { rows: [
    { id:'A', count:0, enabled:false, note:null },
    { id:'B', count:3, enabled:true, note:'' },
    { id:'C', count:4, enabled:false, note:'0012' }
  ] };
  const out = exercise(input);
  assert.deepEqual(out.rows, input.rows);
  assert.ok(out.downloaded, 'same-schema records should reach CSV review');
});
test('nested source values and arrays map consistently on every row', () => {
  const out = exercise({ rows: [
    { id:'A', site:{ name:'North', area:{ name:'Cutting' } }, roles:['one','two'] },
    { id:'B', site:{ name:'South', area:{ name:'Packing' } }, roles:[] }
  ] });
  assert.deepEqual(out.rows, [
    { id:'A', 'site.name':'North', 'site.area.name':'Cutting', roles:2 },
    { id:'B', 'site.name':'South', 'site.area.name':'Packing', roles:0 }
  ]);
  assert.ok(out.downloaded);
});
test('heterogeneous rows preserve missing and explicit null as distinct', () => {
  const out = exercise({ rows: [{ id:'A', note:null }, { id:'B' }] });
  assert.deepEqual(out.rows, [{ id:'A', note:null }, { id:'B' }]);
  assert.equal(out.downloaded, undefined, 'reviewed CSV fails closed on absent column');
  assert.equal(out.blob, undefined);
  assert.match(out.notice, /Could not prepare CSV review/);
});
test('heterogeneous rows preserve an additional later nested field and fail closed', () => {
  const out = exercise({ rows: [{ id:'A', site:{ name:'North' } }, { id:'B', site:{ name:'South', zone:'Z' } }] });
  assert.deepEqual(out.rows, [
    { id:'A', 'site.name':'North' },
    { id:'B', 'site.name':'South', 'site.zone':'Z' }
  ]);
  assert.equal(out.downloaded, undefined);
  assert.match(out.notice, /Could not prepare CSV review/);
});
test('ordinary JSON own __proto__ text field remains visible as a data field', () => {
  const input = JSON.parse('{"rows":[{"id":"A","__proto__":"literal"},{"id":"B","__proto__":"other"}]}');
  const out = exercise(input);
  assert.ok(Object.hasOwn(out.rows[0], '__proto__'), 'source key disappeared in flatten');
  assert.equal(out.rows[0].__proto__, 'literal');
  assert.ok(Object.hasOwn(out.rows[1], '__proto__'));
  assert.equal(out.rows[1].__proto__, 'other');
});
