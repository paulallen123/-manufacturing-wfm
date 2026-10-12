'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { formatInterchange, parseCanonical } = require('./vector-report-interchange.cjs');

const identity = Object.freeze({ sourceId: 'synthetic-source', reportId: 'synthetic-report',
  sourceDigest: '1'.repeat(64), definitionDigest: '2'.repeat(64), scopeDigest: '3'.repeat(64) });
const column = (id, type, overrides = {}) => ({ id, header: id, type, nullable: true,
  unit: null, currency: null, scale: null, ...overrides });
function fixture() {
  return { purpose: 'machine-interchange', consumerProfile: 'vector-json-v1', identity: { ...identity },
    exportedAt: '2026-10-11T12:00:00.000Z',
    context: { locale: 'en-GB', decimalSeparator: '.', grouping: 'none', timeZone: 'UTC', dstPolicy: 'not-applicable-utc' },
    columns: [column('value', 'text')], rows: [['hello']] };
}
function format(input) { return formatInterchange(input, identity); }
function review(input) { input.purpose = 'spreadsheet-display'; input.consumerProfile = 'vector-csv-review-v1'; return format(input); }
function roundTrip(input) {
  const result = format(input), p = parseCanonical(result.canonical, identity);
  assert.deepEqual(p.rows, input.rows); assert.deepEqual(p.columns, input.columns);
  const recovered = Object.fromEntries(Object.keys(input).map(k => [k, p[k]]));
  assert.equal(format(recovered).canonical, result.canonical);
  return result;
}
function boundaryFixture() {
  const f = fixture();
  f.columns = Array.from({ length: 34 }, (_, i) => column('c' + i, 'text'));
  f.rows = Array.from({ length: 5706 }, () => Array(34).fill(''));
  return f;
}
function nodeCount(value) {
  return 1 + (value !== null && typeof value === 'object'
    ? Object.values(value).reduce((n, v) => n + nodeCount(v), 0) : 0);
}
// Independent strict CSV reader used only by tests; no spreadsheet is invoked.
function csvRecords(csv) {
  const rows = []; let row = [], i = 0;
  while (i < csv.length) {
    assert.equal(csv[i++], '"'); let cell = '', closed = false;
    while (i < csv.length) {
      const ch = csv[i++];
      if (ch !== '"') cell += ch;
      else if (csv[i] === '"') { cell += '"'; i++; }
      else { closed = true; break; }
    }
    assert.ok(closed); row.push(cell);
    if (csv[i] === ',') { i++; continue; }
    assert.equal(csv.slice(i, i + 2), '\r\n'); i += 2; rows.push(row); row = [];
  }
  assert.equal(row.length, 0); return rows;
}

test('exact typed canonical round-trip preserves presence, identifiers and precision', () => {
  const f = fixture();
  f.columns = [column('text', 'text'), column('id', 'identifier'), column('flag', 'boolean'),
    column('count', 'integer', { unit: 'count' }), column('amount', 'decimal', { unit: 'currency', currency: 'GBP', scale: 2 }),
    column('date', 'date'), column('instant', 'instant')];
  f.rows = [[null, '000012345678901234567890', false, 0, '-12345678901234567890.00', '2024-02-29', '2026-10-25T01:30:00.000Z'],
    ['', '001', true, 1, '0.00', null, null], ['—', '1E10', null, null, null, null, null], ['-', '2026-10-11', false, 0, '1.20', null, null]];
  const before = structuredClone(f), result = roundTrip(f);
  assert.deepEqual(f, before); assert.equal(result.display, null);
  assert.equal(result.envelope.payload.identity.definitionDigest, identity.definitionDigest);
  assert.equal(result.envelope.payload.rowCount, 4); assert.equal(result.envelope.payload.columnCount, 7);
});

test('formula prefixes and leading whitespace/control characters stay data in canonical and tagged review cells', () => {
  const values = [];
  for (const prefix of ['=', '+', '-', '@']) for (const lead of ['', ' ', '\t', '\r', '\n', '\0', '\u000b', '\u001f', '\u007f', '\u0085', '\u00a0', '\ufeff', '\u200b', '\u202e']) {
    values.push(lead + prefix + 'HYPERLINK("https://example.invalid","link")');
  }
  values.push('https://example.invalid', 'mailto:fixture@example.invalid', '\\server\share', 'line 1\r\nline 2', '"a",b', '00123', '12345678901234567890', '1/2', '1e10', '2026-10-11', 'é e\u0301 日本語 😀 \u202eabc\u2066def');
  const f = fixture(); f.rows = values.map(v => [v]); roundTrip(f);
  const result = review(f), records = csvRecords(result.display.csv);
  assert.equal(result.display.typedRoundTrip, false);
  assert.match(result.display.formulaDisposition, /external-consumers-unproven/);
  assert.equal(records.length, values.length + 1);
  assert.deepEqual(records[0], ['header:"value"']);
  records.slice(1).forEach((row, i) => {
    assert.match(row[0], /^text:/); assert.doesNotMatch(row[0], /[^\x20-\x7e]/);
    assert.equal(JSON.parse(row[0].slice(5)), values[i]);
  });
  assert.ok(result.display.csv.endsWith('\r\n'));
  assert.equal(parseCanonical(result.canonical, identity).rows.length, values.length);
});

test('display distinctly tags null, empty, zero, false and literal dashes', () => {
  const f = fixture(); f.columns = [column('t', 'text'), column('n', 'integer', { unit: 'count' }), column('b', 'boolean')];
  f.rows = [[null, 0, false], ['', null, null], ['—', 1, true], ['-', 2, false]];
  assert.deepEqual(csvRecords(review(f).display.csv).slice(1), [
    ['null:null', 'integer:0', 'boolean:false'], ['text:""', 'null:null', 'null:null'],
    ['text:"\\u2014"', 'integer:1', 'boolean:true'], ['text:"-"', 'integer:2', 'boolean:false']]);
});

test('decimal locale explicit; canonical stays dot decimal with exact scale', () => {
  const f = fixture(); f.columns = [column('quantity', 'decimal', { unit: 'hours', scale: 2 })]; f.rows = [['12.30']];
  f.context.locale = 'de-DE'; f.context.decimalSeparator = ',';
  const result = review(f); assert.equal(csvRecords(result.display.csv)[1][0], 'decimal:"12,30"');
  assert.deepEqual(parseCanonical(result.canonical, identity).rows, [['12.30']]);
  for (const v of ['12,30', '1,234.50', '1e2', '01.20', '1.2', 1.2, 'NaN']) { f.rows = [[v]]; assert.throws(() => format(f)); }
});

test('timezone and DST ambiguity rejected; only millisecond UTC instants and valid dates', () => {
  const f = fixture(); f.columns = [column('instant', 'instant')];
  for (const v of ['2026-10-25T01:30:00', '2026-03-29T01:30:00+01:00', '2026-10-25T01:30:00Z', '2026-02-30T00:00:00.000Z', '2026-10-11T24:00:00.000Z', '2026-10-11T00:00:60.000Z']) {
    f.rows = [[v]]; assert.throws(() => format(f));
  }
  f.rows = [['2026-10-25T01:30:00.000Z']]; roundTrip(f);
  f.context.timeZone = 'Europe/London'; assert.throws(() => format(f), /timezone/);
  f.context.timeZone = 'UTC'; f.context.dstPolicy = 'earlier'; assert.throws(() => format(f), /DST/);
  f.context.dstPolicy = 'not-applicable-utc'; f.columns = [column('day', 'date')];
  for (const v of ['2025-02-29', '2026-13-01', '01/02/2026', '0000-01-01']) { f.rows = [[v]]; assert.throws(() => format(f)); }
});

test('missing, ambiguous and unsupported schema/context/consumer contracts fail closed', () => {
  const mutations = [
    f => delete f.purpose, f => delete f.consumerProfile, f => f.consumerProfile = 'Excel',
    f => f.consumerProfile = 'Google Sheets', f => f.purpose = 'payroll-import',
    f => delete f.identity, f => delete f.exportedAt, f => delete f.context,
    f => delete f.context.locale, f => f.context.locale = 'en-US', f => f.context.decimalSeparator = ',',
    f => f.context.grouping = ',', f => f.columns = [], f => f.columns = ['value'],
    f => delete f.columns[0].nullable, f => f.columns[0].type = 'number',
    f => f.columns.push(column('value', 'text')), f => f.columns.push(column('other', 'text', { header: 'VALUE' })),
    f => f.columns[0].header = '=FORMULA()', f => f.columns[0].header = 'a\u202eb',
    f => f.columns[0].header = '', f => f.columns[0].unit = 'hours',
    f => f.rows = [[null, 'extra']], f => f.rows = [{}], f => f.columns[0].nullable = null,
    f => { f.columns[0].nullable = false; f.rows = [[null]]; },
    f => { f.columns = [column('n', 'integer')]; f.rows = [[1]]; },
    f => { f.columns = [column('n', 'decimal', { unit: 'currency', scale: 2 })]; f.rows = [['1.00']]; },
    f => { f.columns = [column('n', 'decimal', { unit: 'currency', currency: ['GBP'], scale: 2 })]; f.rows = [['1.00']]; },
    f => f.extra = true
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => format(f), mutate.toString()); }
  assert.throws(() => formatInterchange(fixture()), /unsupported value/);
});

test('objects, coercion, unsafe numbers, sparse arrays and accessors rejected without evaluation', () => {
  for (const value of [{}, [], new Date(), new Map(), undefined, 1n, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1, () => {}, Symbol('x'), '\ud800']) {
    const f = fixture(); f.rows = [[value]]; assert.throws(() => format(f));
  }
  const f = fixture(); let calls = 0;
  Object.defineProperty(f.rows[0], '0', { get() { calls++; return 'bad'; }, enumerable: true });
  assert.throws(() => format(f), /accessors/); assert.equal(calls, 0);
  const hole = fixture(); hole.rows = [new Array(1)]; assert.throws(() => format(hole), /dense|holes/);
  const cycle = fixture(); cycle.rows[0][0] = cycle; assert.throws(() => format(cycle), /cycle/);
  const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: true }); assert.throws(() => format(hidden), /hidden/);
  const symbol = fixture(); symbol[Symbol('x')] = true; assert.throws(() => format(symbol), /symbol/);
  const poisoned = fixture(); poisoned.rows = [[JSON.parse('{"__proto__":{}}')]]; assert.throws(() => format(poisoned), /reserved/);
  for (const [type, value, unit] of [['identifier', 123, null], ['boolean', 'false', null], ['integer', '0', 'count']]) {
    const x = fixture(); x.columns = [column('x', type, { unit })]; x.rows = [[value]]; assert.throws(() => format(x));
  }
});

test('identity binding includes source, report, immutable definition and opaque authorised scope', () => {
  const result = format(fixture());
  for (const key of Object.keys(identity)) {
    const changed = { ...identity, [key]: key.endsWith('Digest') ? 'f'.repeat(64) : 'other' };
    assert.throws(() => formatInterchange(fixture(), changed), /binding/);
    assert.throws(() => parseCanonical(result.canonical, changed), /binding/);
  }
  const f = fixture(); f.identity.definitionDigest = 'bad'; assert.throws(() => format(f), /definitionDigest/);
});

test('changed row/header order, count, schema, values and digests are rejected', () => {
  const f = fixture(); f.columns.push(column('other', 'text')); f.rows = [['a', 'b'], ['c', 'd']];
  const result = format(f);
  const mutations = [e => e.payload.rows.reverse(), e => e.payload.columns.reverse(),
    e => e.payload.rows.pop(), e => e.payload.rows[0][0] = 'changed', e => e.payload.rowCount++,
    e => e.payload.columnCount++, e => e.payload.columns[0].header = 'changed',
    e => e.payload.schemaDigest = 'f'.repeat(64), e => e.payload.rowsDigest = 'f'.repeat(64),
    e => e.payloadDigest = 'f'.repeat(64), e => e.payload.version = 'v2'];
  for (const mutate of mutations) {
    const e = JSON.parse(result.canonical); mutate(e);
    // Preserve sorted keys so failure is not merely whitespace/key formatting.
    assert.throws(() => parseCanonical(JSON.stringify(e), identity));
  }
  const changed = structuredClone(f); changed.rows.reverse();
  assert.notEqual(format(changed).envelope.payload.rowsDigest, result.envelope.payload.rowsDigest);
  changed.columns.reverse(); assert.notEqual(format(changed).envelope.payload.schemaDigest, result.envelope.payload.schemaDigest);
});

test('canonical byte encoding, deterministic key ordering and integrity digest are explicit', () => {
  const f = fixture(), a = format(f);
  assert.equal(format(Object.fromEntries(Object.entries(f).reverse())).canonical, a.canonical);
  assert.equal(a.envelope.payloadDigest, createHash('sha256').update('VECTOR_REPORT_INTERCHANGE_V1:payload\n' + JSON.stringify(JSON.parse(a.canonical).payload)).digest('hex'));
  assert.throws(() => parseCanonical(a.canonical + '\n', identity));
  assert.throws(() => parseCanonical(a.canonical.replace('"rowCount":1', '"rowCount":1,"rowCount":1'), identity));
  assert.throws(() => parseCanonical(a.canonical.replace('"rowCount":1', '"rowCount":1.0'), identity));
  const empty = fixture(); empty.rows = []; const r = review(empty);
  assert.equal(parseCanonical(r.canonical, identity).rowCount, 0); assert.equal(csvRecords(r.display.csv).length, 1);
  assert.throws(() => parseCanonical('x'.repeat(8 * 1024 * 1024 + 1), identity), /bounded/);
  const huge = fixture(); huge.rows = Array.from({ length: 129 }, () => ['x'.repeat(65536)]);
  assert.throws(() => format(huge), /string budget/);
});

test('exact 200000-input-node limit formats and parses with seven envelope nodes', () => {
  const f = boundaryFixture();
  assert.equal(nodeCount(f), 200000);
  const result = roundTrip(f);
  assert.equal(nodeCount(result.envelope), 200007);
  assert.equal(result.envelope.payload.rowCount, 5706);
  assert.equal(result.envelope.payload.columnCount, 34);
});

test('one node over the input and envelope limits fails in both directions', () => {
  const f = boundaryFixture();
  const envelope = JSON.parse(format(f).canonical);
  // One additional cell creates exactly one extra node. Resource validation
  // must reject it before row-width or integrity checks, in either direction.
  f.rows[0].push('');
  envelope.payload.rows[0].push('');
  assert.equal(nodeCount(f), 200001);
  assert.equal(nodeCount(envelope), 200008);
  assert.throws(() => format(f), /input limits exceeded/);
  assert.throws(() => parseCanonical(JSON.stringify(envelope), identity), /input limits exceeded/);
});

test('column IDs reject case and trailing-whitespace collisions despite distinct headers', () => {
  for (const duplicate of ['VALUE', 'value ', 'VaLuE ']) {
    const f = fixture();
    f.columns = [column('value', 'text', { header: 'First' }), column('other', 'text', { header: 'Second' })];
    f.rows = [['a', 'b']];
    const envelope = JSON.parse(format(f).canonical);
    f.columns[1].id = duplicate;
    envelope.payload.columns[1].id = duplicate;
    assert.throws(() => format(f), /duplicate column id\/header/);
    assert.throws(() => parseCanonical(JSON.stringify(envelope), identity), /duplicate column id\/header/);
  }
});
