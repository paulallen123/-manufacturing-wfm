'use strict';
const assert = require('node:assert/strict');
const { formatInterchange, parseCanonical } = require('../reporting/runtime/vector-report-interchange.cjs');

const identity = { sourceId: 'adversarial-fixture', reportId: 'review', sourceDigest: '1'.repeat(64), definitionDigest: '2'.repeat(64), scopeDigest: '3'.repeat(64) };
const columns = [
  { id: 'text', header: 'Text', type: 'text', nullable: true, unit: null, currency: null, scale: null },
  { id: 'id', header: 'ID', type: 'identifier', nullable: false, unit: null, currency: null, scale: null },
  { id: 'count', header: 'Count', type: 'integer', nullable: false, unit: 'count', currency: null, scale: null },
  { id: 'flag', header: 'Flag', type: 'boolean', nullable: false, unit: null, currency: null, scale: null },
  { id: 'money', header: 'Money', type: 'decimal', nullable: false, unit: 'currency', currency: 'GBP', scale: 2 }
];
const hazard = ['=1+1', '+cmd', '-SUM(1)', '@HYPERLINK("https://invalid.example")', '\t=1+1', '\r=1+1', '\n=1+1', '\u202e=1+1', '00123', '', null, '—', '"quoted",\r\nline'];
let seed = 0x1234abcd;
function next() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
let cases = 0, mutations = 0;
for (let iteration = 0; iteration < 200; iteration++) {
  const rows = Array.from({ length: 1 + next() % 40 }, () => [hazard[next() % hazard.length], String(next()).padStart(20, '0'), next() % 1000, !!(next() % 2), `${next() % 1000}.${String(next() % 100).padStart(2, '0')}`]);
  const input = { purpose: 'spreadsheet-display', consumerProfile: 'vector-csv-review-v1', identity, exportedAt: '2026-10-12T20:00:00.000Z', context: { locale: 'en-GB', decimalSeparator: '.', grouping: 'none', timeZone: 'UTC', dstPolicy: 'not-applicable-utc' }, columns, rows };
  const result = formatInterchange(input, identity);
  const parsed = parseCanonical(result.canonical, identity);
  assert.deepEqual(parsed.rows, rows);
  assert.deepEqual(parsed.columns, columns);
  assert.equal(result.display.typedRoundTrip, false);
  for (const cell of result.display.csv.match(/"(?:[^"]|"")*"/g) || []) {
    const unescaped = cell.slice(1, -1).replace(/""/g, '"');
    assert.match(unescaped, /^(?:header|text|identifier|integer|boolean|decimal|null):/);
  }
  cases++;
  const tampered = JSON.parse(result.canonical);
  tampered.payload.rows[0][0] = 'different';
  assert.throws(() => parseCanonical(JSON.stringify(tampered), identity));
  mutations++;
  const wrongScope = { ...identity, scopeDigest: 'f'.repeat(64) };
  assert.throws(() => parseCanonical(result.canonical, wrongScope), /binding/);
  mutations++;
}
process.stdout.write(JSON.stringify({ source: 'reporting/runtime/vector-report-interchange.cjs', seed: '0x1234abcd', cases, mutations, status: 'PASS', scope: 'local-source-only' }) + '\n');
