import crypto from 'node:crypto';

export const EVENT_GRAPH_VERSION = 'manufacturing-event-graph-v0.1.0';

const parseMs = value => {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const stable = value => Array.isArray(value)
  ? value.map(stable)
  : (value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value);

export const stableHash = value => crypto
  .createHash('sha256')
  .update(JSON.stringify(stable(value)))
  .digest('hex');

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

export function normalizeManufacturingEvent(event, scope) {
  if (!event || typeof event !== 'object') throw new TypeError('event must be an object');
  const normalized = {
    eventId: assertString(event.eventId, 'eventId'),
    tenantId: assertString(event.tenantId, 'tenantId'),
    siteId: assertString(event.siteId, 'siteId'),
    source: assertString(event.source, 'source'),
    entityType: assertString(event.entityType, 'entityType'),
    entityId: assertString(event.entityId, 'entityId'),
    eventType: assertString(event.eventType, 'eventType'),
    occurredAt: event.occurredAt,
    observedAt: event.observedAt ?? event.occurredAt,
    revision: Number(event.revision ?? 0),
    confidence: Number(event.confidence ?? 1),
    status: event.status ?? 'active',
    payload: event.payload && typeof event.payload === 'object' ? structuredClone(event.payload) : {},
  };

  if (scope?.tenantId && normalized.tenantId !== scope.tenantId) throw new Error('event_tenant_mismatch');
  if (scope?.siteId && normalized.siteId !== scope.siteId) throw new Error('event_site_mismatch');
  if (parseMs(normalized.occurredAt) === null) throw new TypeError('occurredAt must be a valid timestamp');
  if (parseMs(normalized.observedAt) === null) throw new TypeError('observedAt must be a valid timestamp');
  if (!Number.isFinite(normalized.revision) || normalized.revision < 0) throw new TypeError('revision must be a non-negative number');
  if (!Number.isFinite(normalized.confidence) || normalized.confidence < 0 || normalized.confidence > 1) throw new TypeError('confidence must be between 0 and 1');

  normalized.contentHash = stableHash({ ...normalized, contentHash: undefined });
  return normalized;
}

function entityKey(event) {
  return `${event.entityType}:${event.entityId}`;
}

export function buildManufacturingEventGraph(events = [], scope = {}) {
  const byEventId = new Map();
  const byEntity = new Map();
  const conflicts = [];
  const duplicates = [];

  for (const raw of Array.isArray(events) ? events : []) {
    const event = normalizeManufacturingEvent(raw, scope);
    const existing = byEventId.get(event.eventId);
    if (existing) {
      if (existing.contentHash === event.contentHash) {
        duplicates.push(event.eventId);
        continue;
      }
      conflicts.push(event.eventId);
      continue;
    }

    byEventId.set(event.eventId, event);
    const key = entityKey(event);
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key).push(event);
  }

  for (const stream of byEntity.values()) {
    stream.sort((a, b) =>
      a.revision - b.revision ||
      parseMs(a.occurredAt) - parseMs(b.occurredAt) ||
      parseMs(a.observedAt) - parseMs(b.observedAt) ||
      a.eventId.localeCompare(b.eventId));
  }

  const graph = {
    version: EVENT_GRAPH_VERSION,
    scope: { tenantId: scope.tenantId ?? null, siteId: scope.siteId ?? null },
    events: [...byEventId.values()],
    duplicates,
    conflicts,
    getEntityEvents(type, id) {
      return structuredClone(byEntity.get(`${type}:${id}`) ?? []);
    },
    getEffectiveEvent(type, id, eventType = null) {
      const stream = (byEntity.get(`${type}:${id}`) ?? [])
        .filter(e => !eventType || e.eventType === eventType)
        .filter(e => !['superseded', 'cancelled', 'invalid'].includes(e.status));
      if (!stream.length) return null;
      return structuredClone(stream[stream.length - 1]);
    },
    getLatestEvent(type, id, eventType = null) {
      const stream = (byEntity.get(`${type}:${id}`) ?? [])
        .filter(e => !eventType || e.eventType === eventType);
      if (!stream.length) return null;
      return structuredClone(stream[stream.length - 1]);
    },
  };

  graph.reproducibilityHash = stableHash({
    version: graph.version,
    scope: graph.scope,
    events: graph.events.map(event => ({ ...event })),
    duplicates: [...duplicates].sort(),
    conflicts: [...conflicts].sort(),
  });

  return graph;
}

export function eventFreshness(event, now, maxAgeMinutes) {
  const nowMs = parseMs(now);
  const observedMs = parseMs(event?.observedAt);
  if (nowMs === null || observedMs === null) return { fresh: false, ageMinutes: null };
  const ageMinutes = Math.max(0, (nowMs - observedMs) / 60000);
  return { fresh: ageMinutes <= maxAgeMinutes, ageMinutes };
}
