'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sourcePath = process.env.V080_SOURCE || require('node:path').join(__dirname, 'vector-reporting-ui.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function exportFixture(rows, columns = []) {
  const available = source.slice(source.indexOf('function availableColumns('), source.indexOf('function cell(v){'));
  const cell = source.slice(source.indexOf('function cell(v){'), source.indexOf('function insight('));
  const csv = source.slice(source.indexOf('function csv(){'), source.indexOf('function printReport(){'));
  assert.ok(available.startsWith('function availableColumns('));
  assert.ok(cell.startsWith('function cell(v){'));
  assert.ok(csv.startsWith('function csv(){'));
  let result, notice, downloaded;
  class Blob { constructor(parts, options) { result = { body: parts.join(''), type: options.type }; } }
  const a = { click() { downloaded = this.download; } };
  const context = {
    state: { rows, columns }, Blob, JSON, Number, String, Date,
    URL: { createObjectURL() { return 'blob:fixture'; }, revokeObjectURL() {} },
    document: { createElement() { return a; } },
    setTimeout(callback) { callback(); },
    toast(message) { notice = message; }
  };
  vm.runInNewContext(available + '\n' + cell + '\n' + csv + '\ncsv()', context);
  return { result, notice, downloaded };
}

test('hostile header and text cannot become an active spreadsheet cell', () => {
  const attack = '=HYPERLINK("https://example.invalid","go")';
  const value = '\ufeff\t\r\n@SUM(1,2)';
  const x = exportFixture([{ [attack]: value }]);
  assert.equal(x.result.type, 'text/csv;charset=utf-8');
  assert.ok(x.downloaded.endsWith('.csv'));
  assert.match(x.result.body, /^"header:/);
  assert.match(x.result.body, /\r\n"text:/);
  assert.doesNotMatch(x.result.body, /\ufeff|\t/);
  assert.doesNotMatch(x.result.body, /\r\n=|\r\n\+|\r\n-|\r\n@/);
});

test('missing own property cannot be filled from inherited __proto__', () => {
  const x = exportFixture([JSON.parse('{"__proto__":"=1+1"}'), {}]);
  assert.equal(x.result, undefined, 'an absent column must abort before download');
  assert.equal(x.downloaded, undefined);
  assert.match(x.notice, /Could not prepare CSV review/);
});

test('typed false, zero, empty, null and identifier remain distinct', () => {
  const x = exportFixture([{ n: false }, { n: 0 }, { n: '' }, { n: null }, { n: '00004' }]);
  for (const marker of ['boolean:false', 'number:0', 'text:""', 'null:null', 'text:"00004"'])
    assert.ok(x.result.body.includes(marker.replaceAll('"', '""')), marker);
});

test('unsupported non-finite and absent values do not trigger a browser download', () => {
  for (const row of [{ n: Infinity }, { n: NaN }, { n: undefined }, {}]) {
    const x = exportFixture([row], ['n']);
    assert.equal(x.result, undefined);
    assert.equal(x.downloaded, undefined);
    assert.match(x.notice, /Could not prepare CSV review/);
  }
});

test('user-facing controls identify only the formats actually produced', () => {
  assert.ok(/data-report-export[^<]*>CSV review</.test(source), 'CSV review label');
  assert.ok(/data-report-print[^<]*>Print</.test(source), 'Print label');
  assert.ok(!/>CSV \/ Excel<|>Print \/ PDF</.test(source), 'no unimplemented formats advertised');
});
