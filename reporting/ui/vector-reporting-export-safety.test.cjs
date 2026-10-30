'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the exact shipped CSV function with a browser-shaped download sink.
function exportFixture(rows, columns) {
  const source = fs.readFileSync(path.join(__dirname, 'vector-reporting-ui.js'), 'utf8');
  const cell = source.slice(source.indexOf('function cell(v){'), source.indexOf('function insight('));
  const csv = source.slice(source.indexOf('function csv(){'), source.indexOf('function printReport(){'));
  assert.ok(cell.startsWith('function cell(v){') && csv.startsWith('function csv(){'));
  let blob, downloaded, notice;
  class Blob {
    constructor(parts, options) { blob = { text: parts.join(''), type: options.type }; }
  }
  const link = { click() { downloaded = this.download; } };
  const sandbox = {
    state: { rows, columns },
    availableColumns(_rows, cols) { return cols; },
    Blob,
    URL: { createObjectURL() { return 'blob:synthetic'; }, revokeObjectURL() {} },
    document: { createElement() { return link; } },
    Date, setTimeout(fn) { fn(); },
    toast(text) { notice = text; },
    JSON, Number, String
  };
  vm.runInNewContext(cell + '\n' + csv + '\ncsv()', sandbox);
  return { blob, downloaded, notice };
}

test('review CSV never starts a cell with a formula, URL or Unicode control', () => {
  const x = exportFixture([
    { value: '=1+1' }, { value: '\t+HYPERLINK("https://example.invalid")' },
    { value: '@SUM(1,2)' }, { value: 'https://example.invalid' },
    { value: '\u202e=1+1' }, { value: 'é and 😀' }
  ], ['value']);
  assert.equal(x.blob.type, 'text/csv;charset=utf-8');
  assert.equal(x.downloaded.endsWith('.csv'), true);
  assert.ok(x.blob.text.split('\r\n').slice(0,-1).every(line => /^"(?:header|text):/.test(line)), x.blob.text);
  assert.match(x.blob.text, /\\u202e/);
  assert.doesNotMatch(x.blob.text, /[^\x00-\x7f]/);
});

test('review CSV retains distinct null, empty, zero, false, and leading-zero ID', () => {
  const x = exportFixture([
    { n: null }, { n: '' }, { n: 0 }, { n: false }, { n: '00001234' }
  ], ['n']);
  for (const marker of ['null:null','text:""','number:0','boolean:false','text:"00001234"'])
    assert.ok(x.blob.text.includes(marker.replaceAll('"','""')), marker);
});

test('unsupported missing value fails closed before any browser download', () => {
  const x = exportFixture([{ n: undefined }], ['n']);
  assert.equal(x.blob, undefined);
  assert.equal(x.downloaded, undefined);
  assert.match(x.notice, /Could not prepare CSV review/);
});

test('labels match the actual CSV and browser print functions', () => {
  const source = fs.readFileSync(path.join(__dirname, 'vector-reporting-ui.js'), 'utf8');
  assert.match(source, /data-report-export[^<]*>CSV review</);
  assert.match(source, /data-report-print[^<]*>Print</);
  assert.doesNotMatch(source, />CSV \/ Excel<|>Print \/ PDF</);
});
