'use strict';

const { types } = require('node:util');

const CONTRACT_VERSION = 'VECTOR_ORDER_MATERIAL_AVAILABILITY_V1';
const MAX_COMPONENTS = 1000;
const MAX_MILLIUNITS = 1_000_000_000_000;
const MAX_INVENTORY_AGE_MS = 15 * 60000;

function own(row, field) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error(`${field} needs an evidence object.`);
  if (types.isProxy(row)) throw Error(`${field} cannot use a proxy evidence object.`);
  const descriptor = Object.getOwnPropertyDescriptor(row, field);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error(`${field} must be an own data field.`);
  return descriptor.value;
}
function label(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error(`${field} needs bounded text.`);
  return value.trim();
}
function instant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(value)) throw Error(`${field} needs a UTC ISO second.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== value) throw Error(`${field} is not a real UTC instant.`);
  return time;
}
function milliunits(value, field, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_MILLIUNITS) throw Error(`${field} must be bounded integer milliunits.`);
  return value;
}
function scope(row, tenantId, siteId, orderId, field) {
  if (own(row, 'tenantId') !== tenantId || own(row, 'siteId') !== siteId || own(row, 'orderId') !== orderId) {
    throw Error(`${field} scope differs from the exact order.`);
  }
}
function array(value, field) {
  if (types.isProxy(value)) throw Error(`${field} cannot use a proxy array.`);
  const length = Array.isArray(value) ? value.length : 0;
  if (length < 1 || length > MAX_COMPONENTS) throw Error(`${field} needs a bounded nonempty array.`);
  return { value, length };
}
function evidence(row, seen, field) {
  const ref = label(own(row, 'evidenceRef'), `${field}.evidenceRef`);
  const digest = label(own(row, 'evidenceDigest'), `${field}.evidenceDigest`);
  if (seen.has(ref) || seen.has(digest) || ref === digest) throw Error('Evidence references and digests must be distinct.');
  seen.add(ref);
  seen.add(digest);
  return { ref, digest };
}

function assessOrderMaterialAvailability(input) {
  const tenantId = label(own(input, 'tenantId'), 'tenantId');
  const siteId = label(own(input, 'siteId'), 'siteId');
  const orderId = label(own(input, 'orderId'), 'orderId');
  const asOfText = own(input, 'asOf');
  const asOf = instant(asOfText, 'asOf');
  const bom = own(input, 'bom');
  scope(bom, tenantId, siteId, orderId, 'BOM');
  if (own(bom, 'complete') !== true) throw Error('Complete exact-order BOM required.');
  const bomSource = label(own(bom, 'source'), 'bom.source');
  const bomRevision = label(own(bom, 'revision'), 'bom.revision');
  const bomDigest = label(own(bom, 'digest'), 'bom.digest');
  const bomObservedAtText = own(bom, 'observedAt');
  const bomObservedAt = instant(bomObservedAtText, 'bom.observedAt');
  const effectiveStart = instant(own(bom, 'effectiveStart'), 'bom.effectiveStart');
  const effectiveEnd = instant(own(bom, 'effectiveEnd'), 'bom.effectiveEnd');
  if (effectiveStart > asOf || effectiveEnd <= asOf || bomObservedAt > asOf) throw Error('BOM revision must be effective and observed at asOf.');

  const inventory = own(input, 'inventory');
  scope(inventory, tenantId, siteId, orderId, 'Inventory');
  if (own(inventory, 'complete') !== true || own(inventory, 'bomRevision') !== bomRevision || own(inventory, 'bomDigest') !== bomDigest) {
    throw Error('Complete inventory snapshot must bind the exact BOM revision.');
  }
  const inventorySource = label(own(inventory, 'source'), 'inventory.source');
  const inventoryRevision = label(own(inventory, 'revision'), 'inventory.revision');
  const inventoryDigest = label(own(inventory, 'digest'), 'inventory.digest');
  const inventoryObservedAtText = own(inventory, 'observedAt');
  const inventoryObservedAt = instant(inventoryObservedAtText, 'inventory.observedAt');
  if (inventoryObservedAt < bomObservedAt || inventoryObservedAt > asOf || asOf - inventoryObservedAt > MAX_INVENTORY_AGE_MS) {
    throw Error('Inventory observation must follow the BOM and remain current.');
  }

  const components = array(own(bom, 'components'), 'bom.components');
  const balances = array(own(inventory, 'balances'), 'inventory.balances');
  if (balances.length !== components.length) throw Error('Inventory snapshot must cover every BOM component exactly once.');
  const seenEvidence = new Set();
  const required = new Map();
  for (let index = 0; index < components.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(components.value, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('BOM components must be explicit data entries.');
    const component = descriptor.value;
    scope(component, tenantId, siteId, orderId, 'BOM component');
    const componentId = label(own(component, 'componentId'), 'componentId');
    const unit = label(own(component, 'unit'), 'component.unit');
    const quantity = milliunits(own(component, 'requiredMilliunits'), 'component.requiredMilliunits', 1);
    const bomEvidence = evidence(component, seenEvidence, 'component');
    if (required.has(componentId)) throw Error('Repeated BOM component ID requires upstream aggregation.');
    required.set(componentId, { unit, quantity, bomEvidence });
  }
  const seenBalances = new Set();
  const shortfalls = [];
  for (let index = 0; index < balances.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(balances.value, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('Inventory balances must be explicit data entries.');
    const balance = descriptor.value;
    scope(balance, tenantId, siteId, orderId, 'Inventory balance');
    const componentId = label(own(balance, 'componentId'), 'balance.componentId');
    const component = required.get(componentId);
    if (!component || seenBalances.has(componentId)) throw Error('Missing, extra or repeated inventory component.');
    seenBalances.add(componentId);
    const unit = label(own(balance, 'unit'), 'balance.unit');
    if (unit !== component.unit) throw Error('BOM and inventory units differ.');
    const allocatable = milliunits(own(balance, 'allocatableMilliunits'), 'balance.allocatableMilliunits', 0);
    const inventoryEvidence = evidence(balance, seenEvidence, 'balance');
    if (allocatable < component.quantity) shortfalls.push(Object.freeze({
      componentId, unit, missingMilliunits: component.quantity - allocatable,
      bomEvidenceRef: component.bomEvidence.ref, bomEvidenceDigest: component.bomEvidence.digest,
      inventoryEvidenceRef: inventoryEvidence.ref, inventoryEvidenceDigest: inventoryEvidence.digest
    }));
  }
  if (seenBalances.size !== required.size) throw Error('Inventory snapshot omits a BOM component.');
  shortfalls.sort((a, b) => a.componentId.localeCompare(b.componentId));
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    status: shortfalls.length ? 'DECLARED_MATERIAL_SHORTFALL' : 'NO_DECLARED_MATERIAL_SHORTFALL',
    tenantId, siteId, orderId, asOf: asOfText,
    bom: Object.freeze({ source: bomSource, revision: bomRevision, digest: bomDigest, observedAt: bomObservedAtText }),
    inventory: Object.freeze({ source: inventorySource, revision: inventoryRevision, digest: inventoryDigest, observedAt: inventoryObservedAtText }),
    componentCount: components.length, shortfallCount: shortfalls.length, shortfalls: Object.freeze(shortfalls),
    sourceAuthenticated: false, actionAuthority: false, claimedSavingsPence: null
  });
}

module.exports = { assessOrderMaterialAvailability, CONTRACT_VERSION };
