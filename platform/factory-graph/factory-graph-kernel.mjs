const ENTITY_TYPES = new Set([
  'organisation','legal_entity','region','policy_set','pay_group','calendar',
  'worker','skill','certification','shift','site','line','asset','maintenance_task',
  'part','product','production_order','energy_tariff','cost_center','decision','outcome',
  'engineering_document','bom','routing','quality_record','supplier'
]);

const RELATION_TYPES = new Set([
  'PARENT_OF','OWNS_ENTITY','OPERATES_SITE','IN_REGION','IN_COUNTRY','GOVERNED_BY',
  'USES_CALENDAR','USES_PAY_GROUP',
  'HAS_SKILL','HAS_CERTIFICATION','WORKS_SHIFT','ASSIGNED_TO','LOCATED_AT','REQUIRES_SKILL',
  'REQUIRES_ASSET','MAINTENANCE_FOR','BLOCKS','USES_PART','PRODUCES','CONSUMES_ENERGY_UNDER',
  'AFFECTS_COST_CENTER','DECISION_FOR','RESULTED_IN','DOCUMENTS','REVISION_OF','CONTAINS_PART',
  'QUALITY_FOR','SUPPLIED_BY'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateEvidence(evidence, label) {
  assert(evidence && typeof evidence === 'object', `${label}.evidence is required`);
  assert(typeof evidence.sourceType === 'string' && evidence.sourceType.length > 0, `${label}.evidence.sourceType is required`);
  assert(typeof evidence.sourceRef === 'string' && evidence.sourceRef.length > 0, `${label}.evidence.sourceRef is required`);
  assert(isIsoDate(evidence.observedAt), `${label}.evidence.observedAt must be ISO date-time`);
}

export function buildFactoryGraph({ entities = [], relations = [], events = [] }) {
  const entityMap = new Map();
  for (const entity of entities) {
    assert(entity && typeof entity === 'object', 'entity must be an object');
    assert(typeof entity.id === 'string' && entity.id.length > 0, 'entity.id is required');
    assert(ENTITY_TYPES.has(entity.type), `unsupported entity type: ${entity.type}`);
    assert(!entityMap.has(entity.id), `duplicate entity id: ${entity.id}`);
    validateEvidence(entity.evidence, `entity:${entity.id}`);
    entityMap.set(entity.id, Object.freeze({ ...entity }));
  }

  const normalizedRelations = relations.map((relation, index) => {
    assert(relation && typeof relation === 'object', `relation:${index} must be an object`);
    assert(RELATION_TYPES.has(relation.type), `unsupported relation type: ${relation.type}`);
    assert(entityMap.has(relation.from), `relation:${index} missing from entity: ${relation.from}`);
    assert(entityMap.has(relation.to), `relation:${index} missing to entity: ${relation.to}`);
    validateEvidence(relation.evidence, `relation:${index}`);
    if (relation.validFrom !== undefined) assert(isIsoDate(relation.validFrom), `relation:${index}.validFrom must be ISO date-time`);
    if (relation.validTo !== undefined) assert(isIsoDate(relation.validTo), `relation:${index}.validTo must be ISO date-time`);
    if (relation.validFrom && relation.validTo) {
      assert(Date.parse(relation.validFrom) <= Date.parse(relation.validTo), `relation:${index} validity window is inverted`);
    }
    return Object.freeze({ ...relation });
  });

  const normalizedEvents = events.map((event, index) => {
    assert(event && typeof event === 'object', `event:${index} must be an object`);
    assert(typeof event.id === 'string' && event.id.length > 0, `event:${index}.id is required`);
    assert(typeof event.kind === 'string' && event.kind.length > 0, `event:${index}.kind is required`);
    assert(isIsoDate(event.occurredAt), `event:${index}.occurredAt must be ISO date-time`);
    assert(Array.isArray(event.entityIds) && event.entityIds.length > 0, `event:${index}.entityIds are required`);
    for (const id of event.entityIds) assert(entityMap.has(id), `event:${index} references missing entity: ${id}`);
    validateEvidence(event.evidence, `event:${index}`);
    return Object.freeze({ ...event });
  });

  return Object.freeze({
    entities: Object.freeze([...entityMap.values()]),
    relations: Object.freeze(normalizedRelations),
    events: Object.freeze(normalizedEvents),
    entityById(id) { return entityMap.get(id) ?? null; },
    related(fromId, relationType) {
      return normalizedRelations
        .filter((r) => r.from === fromId && (!relationType || r.type === relationType))
        .map((r) => entityMap.get(r.to));
    },
    relatedAt(fromId, relationType, at) {
      assert(isIsoDate(at), 'relatedAt.at must be ISO date-time');
      const t = Date.parse(at);
      return normalizedRelations
        .filter((r) => r.from === fromId && (!relationType || r.type === relationType))
        .filter((r) => (!r.validFrom || Date.parse(r.validFrom) <= t) && (!r.validTo || t <= Date.parse(r.validTo)))
        .map((r) => entityMap.get(r.to));
    }
  });
}

export const FACTORY_GRAPH_ENTITY_TYPES = Object.freeze([...ENTITY_TYPES]);
export const FACTORY_GRAPH_RELATION_TYPES = Object.freeze([...RELATION_TYPES]);
