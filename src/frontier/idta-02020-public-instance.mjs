import { canonicalAasReference, IDTA_02020 } from './idta-02020-capability-profile.mjs';

export const IDTA_02020_PUBLIC_INSTANCE_VERSION = 'idta-02020-public-instance-v0.1.0';

const CONTAINER_KEYS = ['value', 'submodelElements', 'statements', 'annotations'];
const TEMPLATE_PREFIXES = [
  'https://admin-shell.io/idta/CapabilityDescription/',
  'https://admin-shell.io/idta/CapabilityProperty',
];
const UNIT_ID_PREFIXES = [
  'http://qudt.org/vocab/unit/',
  'https://qudt.org/vocab/unit/',
  'http://si-digital-framework.org/SI/units/',
  'https://si-digital-framework.org/SI/units/',
];

function directChildren(node) {
  const out = [];
  for (const key of CONTAINER_KEYS) {
    if (Array.isArray(node?.[key])) out.push(...node[key].filter((item) => item && typeof item === 'object'));
  }
  return out;
}

function semanticIdOf(node) {
  return canonicalAasReference(node?.semanticId);
}

function isTemplateSemantic(value) {
  return typeof value === 'string' && TEMPLATE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isKnownUnitId(value) {
  return typeof value === 'string' && UNIT_ID_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function domainSemantic(node) {
  const primary = semanticIdOf(node);
  if (primary && !isTemplateSemantic(primary)) return primary;
  return (node?.supplementalSemanticIds ?? [])
    .map(canonicalAasReference)
    .find((item) => item && !isTemplateSemantic(item)) ?? null;
}

function propertySemantic(container) {
  for (const item of directChildren(container)) {
    if ((semanticIdOf(item) === IDTA_02020.sameProperty || item?.idShort === 'SameProperty') && item?.second) {
      const linked = canonicalAasReference(item.second);
      if (linked) return linked;
    }
  }
  for (const item of directChildren(container)) {
    const semantic = domainSemantic(item);
    if (semantic) return semantic;
  }
  return null;
}

function explicitEmbeddedUnit(element) {
  const candidates = [];
  for (const embedded of element?.embeddedDataSpecifications ?? []) {
    const contentId = canonicalAasReference(embedded?.dataSpecificationContent?.unitId);
    if (contentId) candidates.push(contentId);
    const specificationId = canonicalAasReference(embedded?.dataSpecification);
    if (isKnownUnitId(specificationId)) candidates.push(specificationId);
  }
  const unique = [...new Set(candidates.filter(Boolean))];
  if (unique.length === 1) return { status: 'resolved', unitId: unique[0], source: 'embedded_unit_reference' };
  if (unique.length > 1) return { status: 'review_required', unitId: null, source: 'ambiguous_embedded_unit_reference' };
  return { status: 'missing', unitId: null, source: null };
}

function scalarValue(element) {
  const raw = element?.value;
  if (raw == null) return null;
  const type = String(element?.valueType ?? '').toLowerCase();
  if (/boolean/.test(type)) {
    if (raw === true || raw === false) return raw;
    if (String(raw).toLowerCase() === 'true') return true;
    if (String(raw).toLowerCase() === 'false') return false;
    return null;
  }
  if (/(double|float|decimal|integer|int|long|short|byte|nonnegativeinteger|positiveinteger)/.test(type)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : null;
}

function numericBound(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compatibleSetValues(items) {
  const values = items.map(scalarValue);
  if (values.some((value) => value == null)) return { status: 'review_required', reason: 'invalid_discrete_value' };
  const numeric = values.every((value) => typeof value === 'number' && Number.isFinite(value));
  const categorical = values.every((value) => typeof value === 'string' || typeof value === 'boolean');
  if (!numeric && !categorical) return { status: 'review_required', reason: 'mixed_discrete_value_types' };
  return { status: 'accepted', values, numeric };
}

function mergeProperty(entry, property) {
  const existing = entry.properties.findIndex((item) => item.semanticId === property.semanticId);
  if (existing >= 0) entry.properties[existing] = { ...entry.properties[existing], ...property };
  else entry.properties.push(property);

  if (Array.isArray(entry?.evidence?.propertyReview)) {
    entry.evidence.propertyReview = entry.evidence.propertyReview.filter((item) => {
      if (item?.semanticId !== property.semanticId) return true;
      return ![
        'missing_explicit_or_semantic_unit',
        'invalid_property_range',
        'unsupported_property_representation',
      ].includes(item?.reason);
    });
  }
}

function enrichEntry(entry, container, stats) {
  const propertySets = directChildren(container).filter((item) => semanticIdOf(item) === IDTA_02020.propertySet || item?.idShort === 'PropertySet');
  for (const propertySet of propertySets) {
    const propertyContainers = directChildren(propertySet).filter((item) => semanticIdOf(item) === IDTA_02020.propertyContainer || String(item?.idShort ?? '').endsWith('Container'));
    for (const propertyContainer of propertyContainers) {
      const semanticId = propertySemantic(propertyContainer);
      if (!semanticId) continue;
      const values = directChildren(propertyContainer);

      const list = values.find((item) => item?.modelType === 'SubmodelElementList');
      if (list) {
        const parsed = compatibleSetValues(Array.isArray(list.value) ? list.value : []);
        if (parsed.status !== 'accepted' || parsed.values.length === 0) {
          stats.reviewRequired += 1;
          continue;
        }
        const unit = explicitEmbeddedUnit(list);
        const eligible = parsed.numeric ? unit.status === 'resolved' : unit.status !== 'review_required';
        mergeProperty(entry, {
          semanticId,
          kind: 'set',
          value: parsed.values,
          unit: null,
          unitId: unit.unitId,
          unitSource: unit.source,
          matchingStatus: eligible ? 'eligible' : 'review_required',
        });
        stats.discreteSets += 1;
        if (unit.status === 'resolved') stats.embeddedUnits += 1;
        if (!eligible) stats.reviewRequired += 1;
        continue;
      }

      const range = values.find((item) => item?.modelType === 'Range');
      if (range) {
        const min = numericBound(range.min);
        const max = numericBound(range.max);
        if (min == null && max == null) continue;
        if (min != null && max != null && min > max) {
          stats.reviewRequired += 1;
          continue;
        }
        const unit = explicitEmbeddedUnit(range);
        const current = entry.properties.find((item) => item.semanticId === semanticId);
        const needsEnrichment = !current || !current.unitId || current.min == null || current.max == null;
        if (!needsEnrichment) continue;
        mergeProperty(entry, {
          semanticId,
          kind: 'range',
          min,
          max,
          unit: current?.unit ?? null,
          unitId: current?.unitId ?? unit.unitId,
          unitSource: current?.unitSource ?? unit.source,
          matchingStatus: (current?.unit || current?.unitId || unit.unitId) ? 'eligible' : 'review_required',
        });
        if (min == null || max == null) stats.oneSidedRanges += 1;
        if (unit.status === 'resolved' && !current?.unitId) stats.embeddedUnits += 1;
        if (!(current?.unit || current?.unitId || unit.unitId)) stats.reviewRequired += 1;
      }
    }
  }
}

function capabilityContainers(submodels) {
  const containers = new Map();
  for (const submodel of submodels ?? []) {
    const stack = [...directChildren(submodel)];
    while (stack.length) {
      const node = stack.pop();
      if (semanticIdOf(node) === IDTA_02020.capabilityContainer || String(node?.idShort ?? '').endsWith('CapabilityContainer')) {
        if (node?.idShort) containers.set(String(node.idShort), node);
      }
      stack.push(...directChildren(node));
    }
  }
  return containers;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

export function enrichIdta02020ProfileFromPublicInstances(profile, submodels = []) {
  const enriched = clone(profile);
  const containers = capabilityContainers(submodels);
  const stats = { discreteSets: 0, oneSidedRanges: 0, embeddedUnits: 0, reviewRequired: 0 };

  for (const bucket of ['offered', 'required', 'notAssigned']) {
    for (const entry of enriched?.[bucket] ?? []) {
      const container = containers.get(String(entry?.evidence?.containerIdShort ?? ''));
      if (container) enrichEntry(entry, container, stats);
    }
  }

  return {
    ...enriched,
    publicInstanceEnrichment: {
      ...stats,
      sourceMutation: false,
      version: IDTA_02020_PUBLIC_INSTANCE_VERSION,
    },
  };
}
