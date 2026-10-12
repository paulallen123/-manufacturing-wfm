'use strict';

// Pure serialization boundary for already-authorised rows. No catalog, auth,
// identity inference, file I/O, clock, providers or spreadsheet execution.
const { createHash } = require('node:crypto');
const VERSION = 'VECTOR_REPORT_INTERCHANGE_V1';
const IDENTITY_KEYS = ['sourceId', 'reportId', 'sourceDigest', 'definitionDigest', 'scopeDigest'];
const INPUT_KEYS = ['purpose', 'consumerProfile', 'identity', 'exportedAt', 'context', 'columns', 'rows'];
const TYPES = new Set(['text', 'identifier', 'boolean', 'integer', 'decimal', 'date', 'instant']);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_NODES = 200000;
// Envelope object plus payloadDigest, version, rowCount, columnCount,
// schemaDigest and rowsDigest. The payload object replaces the input object.
const ENVELOPE_EXTRA_NODES = 7;

function requireThat(ok, message) {
  if (!ok) throw new TypeError('Interchange: ' + message);
}

// Accept only inert, dense JSON data; reject accessors without calling them.
// JavaScript proxies are outside this in-process API's trust boundary.
function copyData(value, depth = 0, seen = new Set(), budget = { nodes: 0, bytes: 0, maxNodes: MAX_INPUT_NODES }) {
  requireThat(depth <= 12 && ++budget.nodes <= budget.maxNodes, 'input limits exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    requireThat(value.length <= 65536 && value.isWellFormed(), 'invalid or oversized Unicode string');
    budget.bytes += Buffer.byteLength(value, 'utf8');
    requireThat(budget.bytes <= MAX_BYTES, 'input string budget exceeded');
    return value;
  }
  if (typeof value === 'number') {
    requireThat(Number.isSafeInteger(value) && !Object.is(value, -0), 'numbers must be safe integers');
    return value;
  }
  requireThat(typeof value === 'object' && !seen.has(value), 'unsupported value or cycle');
  const array = Array.isArray(value);
  requireThat(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype), 'plain JSON data required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  requireThat(keys.every(k => typeof k === 'string'), 'symbol properties unsupported');
  if (array) {
    requireThat(value.length <= 10000 && keys.length === value.length + 1, 'dense bounded arrays required');
    for (let i = 0; i < value.length; i++) requireThat(Object.hasOwn(descriptors, i), 'array holes unsupported');
  }
  const out = array ? [] : {};
  seen.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const d = descriptors[key];
    requireThat(d.enumerable && Object.hasOwn(d, 'value'), 'accessors or hidden properties unsupported');
    requireThat(!['__proto__', 'prototype', 'constructor'].includes(key), 'reserved property');
    out[key] = copyData(d.value, depth + 1, seen, budget);
  }
  seen.delete(value);
  return out;
}

function exactKeys(value, keys, name) {
  requireThat(value && !Array.isArray(value) && typeof value === 'object', name + ' object required');
  requireThat(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), name + ' keys mismatch');
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function digest(domain, value) {
  return createHash('sha256').update(VERSION + ':' + domain + '\n' + stable(value), 'utf8').digest('hex');
}
function hash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function label(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ /:-]{0,119}$/.test(value); }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false;
  const ms = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
function instant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    date(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function identity(value) {
  exactKeys(value, IDENTITY_KEYS, 'identity');
  requireThat(label(value.sourceId) && label(value.reportId), 'explicit source/report identifiers required');
  for (const key of ['sourceDigest', 'definitionDigest', 'scopeDigest']) requireThat(hash(value[key]), 'invalid ' + key);
}
function validate(input, expected) {
  exactKeys(input, INPUT_KEYS, 'input');
  identity(input.identity);
  identity(expected);
  requireThat(stable(input.identity) === stable(expected), 'identity binding mismatch');
  const machine = input.purpose === 'machine-interchange';
  requireThat(machine || input.purpose === 'spreadsheet-display', 'unsupported purpose');
  requireThat(input.consumerProfile === (machine ? 'vector-json-v1' : 'vector-csv-review-v1'), 'unsupported consumer profile');
  requireThat(instant(input.exportedAt), 'explicit UTC export instant required');
  const c = input.context;
  exactKeys(c, ['locale', 'decimalSeparator', 'grouping', 'timeZone', 'dstPolicy'], 'context');
  requireThat((c.locale === 'en-GB' && c.decimalSeparator === '.') ||
    (c.locale === 'de-DE' && c.decimalSeparator === ','), 'unsupported locale/decimal context');
  requireThat(c.grouping === 'none' && c.timeZone === 'UTC' && c.dstPolicy === 'not-applicable-utc', 'unsupported grouping/timezone/DST context');
  requireThat(Array.isArray(input.columns) && input.columns.length > 0 && input.columns.length <= 100, '1..100 explicit columns required');
  const headers = new Set(), ids = new Set();
  for (const col of input.columns) {
    exactKeys(col, ['id', 'header', 'type', 'nullable', 'unit', 'currency', 'scale'], 'column');
    requireThat(label(col.id) && label(col.header), 'ASCII column id/header required');
    const idKey = col.id.trim().toLowerCase(), headerKey = col.header.trim().toLowerCase();
    requireThat(!ids.has(idKey) && !headers.has(headerKey), 'duplicate column id/header');
    ids.add(idKey); headers.add(headerKey);
    requireThat(TYPES.has(col.type) && typeof col.nullable === 'boolean', 'explicit supported type/nullability required');
    const numeric = col.type === 'integer' || col.type === 'decimal';
    requireThat(numeric ? label(col.unit) : col.unit === null, 'explicit numeric unit required; other units unsupported');
    requireThat(col.type === 'decimal' ? Number.isInteger(col.scale) && col.scale >= 0 && col.scale <= 18 : col.scale === null, 'invalid scale');
    requireThat(col.currency === null || (typeof col.currency === 'string' && col.type === 'decimal' && col.unit === 'currency' && /^[A-Z]{3}$/.test(col.currency)), 'invalid currency context');
    requireThat(col.unit !== 'currency' || col.currency !== null, 'currency code required');
  }
  requireThat(Array.isArray(input.rows) && input.rows.length <= 10000, 'bounded rows array required');
  for (const row of input.rows) {
    requireThat(Array.isArray(row) && row.length === input.columns.length, 'row width mismatch');
    row.forEach((v, i) => {
      const col = input.columns[i];
      if (v === null) { requireThat(col.nullable, 'null in non-nullable column'); return; }
      let ok = false;
      switch (col.type) {
        case 'text': ok = typeof v === 'string'; break;
        case 'identifier': ok = typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v); break;
        case 'boolean': ok = typeof v === 'boolean'; break;
        case 'integer': ok = Number.isSafeInteger(v) && !Object.is(v, -0); break;
        case 'decimal': ok = typeof v === 'string' && new RegExp('^-?(0|[1-9][0-9]*)' + (col.scale ? '\\.[0-9]{' + col.scale + '}' : '') + '$').test(v); break;
        case 'date': ok = date(v); break;
        case 'instant': ok = instant(v); break;
      }
      requireThat(ok, 'value does not match declared ' + col.type);
    });
  }
}

// ASCII-only tagged review cells. No raw formula/link/control/bidi content is
// put at the start of any cell. This is a representation rule, not evidence
// about Excel/Sheets import, re-save or execution behaviour. No CSV importer.
function token(type, value) {
  return type + ':' + JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}
function display(input) {
  const quote = s => '"' + s.replace(/"/g, '""') + '"';
  const records = [input.columns.map(col => token('header', col.header))];
  for (const row of input.rows) records.push(row.map((v, i) => {
    const type = input.columns[i].type;
    if (v !== null && type === 'decimal') v = v.replace('.', input.context.decimalSeparator);
    return token(v === null ? 'null' : type, v);
  }));
  const csv = records.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
  return {
    consumerProfile: 'vector-csv-review-v1', mediaType: 'text/csv;charset=utf-8',
    representation: 'ascii-tagged-review-only', typedRoundTrip: false,
    formulaDisposition: 'all-cells-tagged-and-escaped; external-consumers-unproven',
    csv, digest: digest('display', csv)
  };
}

function build(input, expected) {
  validate(input, expected);
  const payload = {
    version: VERSION, ...input, rowCount: input.rows.length, columnCount: input.columns.length,
    schemaDigest: digest('schema', { columns: input.columns, context: input.context }),
    rowsDigest: digest('rows', input.rows)
  };
  const envelope = { payload, payloadDigest: digest('payload', payload) };
  const canonical = stable(envelope);
  requireThat(Buffer.byteLength(canonical, 'utf8') <= MAX_BYTES, 'canonical size limit exceeded');
  return { canonical, envelope, display: input.purpose === 'spreadsheet-display' ? display(input) : null };
}

function formatInterchange(input, expectedIdentity) {
  return build(copyData(input), copyData(expectedIdentity));
}

function parseCanonical(text, expectedIdentity) {
  requireThat(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_BYTES, 'bounded canonical text required');
  const envelope = copyData(JSON.parse(text), 0, new Set(), {
    nodes: 0, bytes: 0, maxNodes: MAX_INPUT_NODES + ENVELOPE_EXTRA_NODES
  });
  exactKeys(envelope, ['payload', 'payloadDigest'], 'envelope');
  exactKeys(envelope.payload, [...INPUT_KEYS, 'version', 'rowCount', 'columnCount', 'schemaDigest', 'rowsDigest'], 'payload');
  const input = Object.fromEntries(INPUT_KEYS.map(key => [key, envelope.payload[key]]));
  // Apply exactly the formatter's input budget as well as the bounded outer
  // traversal; unused/malformed metadata cannot enlarge the input allowance.
  const rebuilt = build(copyData(input), copyData(expectedIdentity));
  // Exact bytes also reject duplicate JSON keys, alternate number spellings,
  // extra keys, changed counts/order/digests and noncanonical JSON whitespace.
  requireThat(rebuilt.canonical === text, 'noncanonical payload or inconsistent counts/digests');
  return rebuilt.envelope.payload;
}

module.exports = Object.freeze({ formatInterchange, parseCanonical });
