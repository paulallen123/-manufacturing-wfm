'use strict';

const { createHash } = require('node:crypto');

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const NODE_TYPES = new Set([
  'tenant', 'legal-entity', 'site', 'department', 'line', 'person', 'role',
  'system', 'integration', 'policy', 'configuration', 'competency',
  'training', 'test', 'evidence', 'readiness-gate',
  'machine', 'automation', 'material', 'wip', 'energy', 'tooling', 'facility',
  'inventory', 'supplier-capacity', 'cash-commitment', 'knowledge',
  'work-order', 'order', 'product', 'quality-event'
]);

function normaliseNode(node, tenant) {
  if (!node || typeof node !== 'object') throw new Error('Twin node is required.');
  const type = String(node.type || '').trim();
  const id = String(node.id || '').trim();
  if (!NODE_TYPES.has(type)) throw new Error('Unsupported twin node type: ' + type);
  if (!id) throw new Error('Twin node requires an id.');
  if (!node.source || !node.observedAt) throw new Error('Twin node requires source and observedAt provenance.');
  return {
    tenant,
    id,
    type,
    state: String(node.state || 'OBSERVED'),
    source: String(node.source),
    observedAt: String(node.observedAt),
    effectiveAt: node.effectiveAt == null ? null : String(node.effectiveAt),
    confidence: node.confidence == null ? null : Number(node.confidence),
    verified: node.verified === true,
    data: clone(node.data || {})
  };
}

function normaliseEdge(edge, tenant, ids) {
  if (!edge || typeof edge !== 'object') throw new Error('Twin edge is required.');
  const from = String(edge.from || '').trim();
  const to = String(edge.to || '').trim();
  const relation = String(edge.relation || '').trim();
  if (!from || !to || !relation) throw new Error('Twin edge requires from, to and relation.');
  if (!ids.has(from) || !ids.has(to)) throw new Error('Twin edge references an unknown node.');
  if (!edge.source || !edge.observedAt) throw new Error('Twin edge requires source and observedAt provenance.');
  return {
    tenant,
    from,
    to,
    relation,
    source: String(edge.source),
    observedAt: String(edge.observedAt),
    effectiveAt: edge.effectiveAt == null ? null : String(edge.effectiveAt),
    verified: edge.verified === true,
    data: clone(edge.data || {})
  };
}

function createTwinRevision(input = {}) {
  const tenant = String(input.tenant || '').trim();
  if (!tenant) throw new Error('Implementation twin requires tenant.');
  const nodes = (input.nodes || []).map(node => normaliseNode(node, tenant));
  const ids = new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error('Twin node ids must be unique.');
    ids.add(node.id);
  }
  const edges = (input.edges || []).map(edge => normaliseEdge(edge, tenant, ids));
  const payload = {
    tenant,
    nodes: nodes.sort((a,b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a,b) => (a.from + '|' + a.relation + '|' + a.to).localeCompare(b.from + '|' + b.relation + '|' + b.to))
  };
  return { ...payload, revision: digest(payload) };
}

function indexById(revision) {
  return new Map((revision?.nodes || []).map(node => [node.id, node]));
}

function impactedNodeIds(previous, next) {
  if (!previous) return new Set((next?.nodes || []).map(node => node.id));
  if (previous.tenant !== next.tenant) throw new Error('Cross-tenant twin comparison denied.');
  const before = indexById(previous);
  const after = indexById(next);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changed = new Set();
  for (const id of ids) {
    if (stable(before.get(id) || null) !== stable(after.get(id) || null)) changed.add(id);
  }
  return changed;
}

function changeImpact(previous, next) {
  const changed = impactedNodeIds(previous, next);
  const nodes = indexById(next);
  const affected = {
    configuration: new Set(),
    integrations: new Set(),
    roles: new Set(),
    training: new Set(),
    tests: new Set(),
    readiness: new Set()
  };
  const adjacency = new Map();
  for (const edge of next.edges || []) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const queue = [...changed];
  const visited = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    const node = nodes.get(id);
    if (node) {
      if (['policy','configuration'].includes(node.type)) affected.configuration.add(id);
      if (['system','integration'].includes(node.type)) affected.integrations.add(id);
      if (node.type === 'role') affected.roles.add(id);
      if (['competency','training'].includes(node.type)) affected.training.add(id);
      if (node.type === 'test') affected.tests.add(id);
      if (node.type === 'readiness-gate') affected.readiness.add(id);
    }
    for (const neighbour of adjacency.get(id) || []) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  const risky = [...changed].map(id => nodes.get(id)).filter(Boolean).some(node =>
    ['integration','policy','configuration','readiness-gate'].includes(node.type) &&
    (node.data?.risk === 'HIGH' || node.data?.risk === 'CRITICAL' || node.verified !== true)
  );
  return {
    fromRevision: previous?.revision || null,
    toRevision: next.revision,
    changed: [...changed].sort(),
    affected: Object.fromEntries(Object.entries(affected).map(([key,value]) => [key,[...value].sort()])),
    authority: risky ? 'APPROVAL_REQUIRED' : 'SAFE_AUTO_CANDIDATE'
  };
}

module.exports = { NODE_TYPES, createTwinRevision, changeImpact, stable, digest };
