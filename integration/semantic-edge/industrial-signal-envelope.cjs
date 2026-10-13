'use strict';
const { createHash } = require('node:crypto');

// A deliberately narrow, read-only OPC UA PubSub JSON profile for shadow experiments.
// This module has no broker client, command publisher, or operational write path.
const SIGNAL_CLASSES = new Set(['machine-state', 'production', 'quality', 'energy', 'maintenance', 'material-flow', 'automated-resource', 'safety-context']);
const validId = x => typeof x === 'string' && x.length > 0 && x.length <= 160 && !/[\x00-\x1f]/.test(x);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const time = x => typeof x === 'string' && /Z$/.test(x) && Number.isFinite(Date.parse(x)) ? Date.parse(x) : NaN;
const version = x => object(x) && Number.isSafeInteger(x.MajorVersion) && x.MajorVersion >= 0 && Number.isSafeInteger(x.MinorVersion) && x.MinorVersion >= 0 ? `${x.MajorVersion}:${x.MinorVersion}` : null;
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');

function createSemanticEdgeBridge({ mappings, freshnessMs = 60000, maxPayloadBytes = 65536 } = {}) {
  if (!Array.isArray(mappings) || !mappings.length || !Number.isSafeInteger(freshnessMs) || freshnessMs < 1 || !Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1) throw new TypeError('bounded explicit mappings required');
  const allowed = new Map();
  for (const m of mappings) {
    if (!validId(m?.tenantId) || !validId(m?.siteId) || !validId(m?.publisherId) || !Number.isInteger(m?.writerId) || m.writerId < 0 || m.writerId > 65535 || !validId(m.namespaceUri) || !object(m.fields) || !Object.keys(m.fields).length) throw new TypeError('invalid source mapping');
    for (const [name, field] of Object.entries(m.fields)) if (!validId(name) || !SIGNAL_CLASSES.has(field?.signalClass) || !validId(field.assetId)) throw new TypeError('invalid field mapping');
    const key = `${m.tenantId}\0${m.siteId}\0${m.publisherId}\0${m.writerId}`;
    if (allowed.has(key)) throw new TypeError('ambiguous source mapping');
    allowed.set(key, structuredClone(m));
  }
  const metadata = new Map(), lastSequence = new Map();
  function ingest({ tenantId, siteId, topic, payload, receivedAt } = {}) {
    const reject = status => ({ status, signals: [] });
    if (topic !== 'metadata' && !(typeof topic === 'string' && /^data\/[A-Za-z0-9._/-]{1,160}$/.test(topic))) return reject('topic-rejected');
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return reject('invalid-payload');
    if (Buffer.byteLength(payload) > maxPayloadBytes) return reject('payload-too-large');
    let message;
    try { message = JSON.parse(String(payload)); } catch { return reject('invalid-payload'); }
    if (!object(message) || !validId(message.MessageId) || !validId(message.PublisherId)) return reject('invalid-payload');
    if (!['ua-data', 'ua-metadata'].includes(message.MessageType) || (topic === 'metadata') !== (message.MessageType === 'ua-metadata')) return reject('message-type-rejected');
    const received = time(receivedAt);
    if (!Number.isFinite(received)) return reject('invalid-time');
    const messages = message.MessageType === 'ua-metadata' ? [message] : Array.isArray(message.Messages) ? message.Messages : [message.Messages];
    if (messages.length !== 1 || !object(messages[0])) return reject('unsupported-layout');
    const item = messages[0];
    const writer = item.DataSetWriterId;
    if (!Number.isInteger(writer) || writer < 0 || writer > 65535) return reject('invalid-writer');
    const key = `${tenantId}\0${siteId}\0${message.PublisherId}\0${writer}`;
    const map = allowed.get(key);
    if (!map) return reject('scope-rejected');
    if (message.MessageType === 'ua-metadata') {
      const fields = item.MetaData?.Fields;
      const v = version(item.MetaData?.ConfigurationVersion);
      if (!v || !Array.isArray(fields) || fields.length < 1 || fields.length > 256 || fields.some(f => !validId(f?.Name)) || new Set(fields.map(f => f.Name)).size !== fields.length || !Number.isFinite(time(item.Timestamp))) return reject('invalid-metadata');
      // Metadata describes names and types; semantic meaning comes only from this explicit trusted mapping.
      metadata.set(key, { version: v, fields: new Set(fields.map(f => f.Name)), digest: hash(item.MetaData) });
      return reject('metadata-accepted');
    }
    const meta = metadata.get(key);
    if (!meta) return reject('metadata-missing');
    if (version(item.MetaDataVersion) !== meta.version) return reject('metadata-version-mismatch');
    if (!Number.isSafeInteger(item.SequenceNumber) || item.SequenceNumber < 0) return reject('invalid-sequence');
    if (lastSequence.has(key) && item.SequenceNumber <= lastSequence.get(key)) return reject(item.SequenceNumber === lastSequence.get(key) ? 'replay' : 'out-of-order');
    if (item.Status !== 0) return reject('quality-rejected');
    if (!object(item.Payload) || !Object.keys(item.Payload).length || Object.keys(item.Payload).length > 256) return reject('invalid-payload');
    const signals = [];
    for (const [name, field] of Object.entries(item.Payload)) {
      if (!meta.fields.has(name) || !map.fields[name]) return reject('unmapped');
      if (!object(field) || field.StatusCode !== 0) return reject('quality-rejected');
      const sourceAt = time(field.SourceTimestamp), messageAt = time(item.Timestamp);
      if (!Number.isFinite(sourceAt) || !Number.isFinite(messageAt)) return reject('invalid-time');
      if (sourceAt > received || received - sourceAt > freshnessMs || messageAt > received || received - messageAt > freshnessMs) return reject('stale');
      if (!['string', 'number', 'boolean'].includes(typeof field.Value) || typeof field.Value === 'number' && !Number.isFinite(field.Value)) return reject('invalid-value');
      const mapping = map.fields[name];
      const core = {
        scope: { tenantId, siteId }, signalClass: mapping.signalClass, assetId: mapping.assetId, value: field.Value,
        unit: mapping.unit || null, quality: 'Good', shadowOnly: true, executionPermitted: false,
        source: { publisherId: message.PublisherId, writerId: writer, namespaceUri: map.namespaceUri, fieldName: name,
          sourceTimestamp: new Date(sourceAt).toISOString(), messageTimestamp: new Date(messageAt).toISOString(), ingestedAt: new Date(received).toISOString(),
          sequenceNumber: item.SequenceNumber, metadataVersion: meta.version, metadataDigest: meta.digest, messageId: message.MessageId },
      };
      signals.push({ ...core, provenanceHash: hash(core) });
    }
    lastSequence.set(key, item.SequenceNumber);
    return { status: 'applied', signals };
  }
  return Object.freeze({ ingest });
}

module.exports = { createSemanticEdgeBridge };
