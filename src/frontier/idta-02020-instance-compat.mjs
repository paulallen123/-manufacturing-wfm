export const IDTA_02020_INSTANCE_COMPAT_VERSION = 'idta-02020-instance-compat-v0.2.0';

const IDTA_SUBMODEL = 'https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0';
const PROPERTY_CONTAINER = 'https://admin-shell.io/idta/CapabilityDescription/PropertyContainer/1/0';
const PROPERTY_TYPE = 'https://admin-shell.io/idta/CapabilityPropertyType/Property/1/0';
const RANGE_TYPE = 'https://admin-shell.io/idta/CapabilityPropertyEnumType/Range/1/0';
const TEMPLATE_PREFIX = 'https://admin-shell.io/idta/';
const CONTAINER_KEYS = ['submodelElements', 'value', 'statements', 'annotations'];

const REFERENCE_ALIASES = new Map([
  ['https://admin-shell.io/idta/CapabilityDescription/1/0/Submodel', IDTA_SUBMODEL],
  ['https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifiers/Required/1/0', 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/Required/1/0'],
  ['https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifiers/Offered/1/0', 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/Offered/1/0'],
  ['https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifiers/NotAssigned/1/0', 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/NotAssigned/1/0'],
]);

function canonicalReference(reference) {
  const keys = Array.isArray(reference?.keys) ? reference.keys.filter((key) => key?.value) : [];
  if (keys.length === 0) return null;
  if (keys.length === 1) return String(keys[0].value);
  return keys.map((key) => `${key.type ?? 'Key'}:${key.value}`).join('>');
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function reference(value) {
  return { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] };
}

function isDomainSemantic(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith(TEMPLATE_PREFIX);
}

function rewriteKnownReference(referenceValue, state) {
  if (!referenceValue || typeof referenceValue !== 'object' || !Array.isArray(referenceValue.keys)) return;
  for (const key of referenceValue.keys) {
    const from = typeof key?.value === 'string' ? key.value : null;
    const to = from ? REFERENCE_ALIASES.get(from) : null;
    if (!to || to === from) continue;
    key.value = to;
    state.normalizedAliases += 1;
    state.aliases.push({ from, to });
  }
}

function normalizeKnownAliases(node, state) {
  if (!node || typeof node !== 'object') return;
  rewriteKnownReference(node.semanticId, state);
  for (const qualifier of node.qualifiers ?? []) rewriteKnownReference(qualifier?.semanticId, state);

  for (const key of CONTAINER_KEYS) {
    const children = node[key];
    if (!Array.isArray(children)) continue;
    for (const child of children) normalizeKnownAliases(child, state);
  }
}

function normalizeElement(node, state) {
  if (!node || typeof node !== 'object') return;
  const semantic = canonicalReference(node.semanticId);
  const isPropertyContainer = semantic === PROPERTY_CONTAINER || String(node.idShort ?? '').startsWith('PropertyContainer');

  if (isPropertyContainer && Array.isArray(node.value)) {
    for (const element of node.value) {
      if (!element || (element.modelType !== 'Property' && element.modelType !== 'Range')) continue;
      const domain = canonicalReference(element.semanticId);
      if (!isDomainSemantic(domain)) continue;

      const supplemental = Array.isArray(element.supplementalSemanticIds) ? element.supplementalSemanticIds : [];
      const otherDomains = supplemental
        .map(canonicalReference)
        .filter((item) => isDomainSemantic(item) && item !== domain);

      if (otherDomains.length) {
        state.reviewRequired.push({
          propertyIdShort: element.idShort ?? null,
          semanticId: domain,
          reason: 'ambiguous_domain_property_semantics',
        });
        continue;
      }

      const existing = supplemental.map(canonicalReference);
      if (!existing.includes(domain)) supplemental.push(reference(domain));
      element.supplementalSemanticIds = supplemental;
      element.semanticId = reference(element.modelType === 'Range' ? RANGE_TYPE : PROPERTY_TYPE);
      state.normalizedProperties += 1;
    }
  }

  for (const key of CONTAINER_KEYS) {
    const children = node[key];
    if (!Array.isArray(children)) continue;
    for (const child of children) normalizeElement(child, state);
  }
}

export function normalizeIdta02020InstanceSubmodels(submodels = []) {
  const normalized = clone(submodels);
  const state = {
    normalizedProperties: 0,
    normalizedAliases: 0,
    matchedSubmodels: 0,
    reviewRequired: [],
    aliases: [],
  };

  for (const submodel of normalized) {
    normalizeKnownAliases(submodel, state);
    if (canonicalReference(submodel?.semanticId) !== IDTA_SUBMODEL) continue;
    state.matchedSubmodels += 1;
    normalizeElement(submodel, state);
  }

  return {
    status: 'accepted',
    submodels: normalized,
    matchedSubmodels: state.matchedSubmodels,
    normalizedProperties: state.normalizedProperties,
    normalizedAliases: state.normalizedAliases,
    aliases: state.aliases,
    reviewRequired: state.reviewRequired,
    sourceMutation: false,
    version: IDTA_02020_INSTANCE_COMPAT_VERSION,
  };
}
