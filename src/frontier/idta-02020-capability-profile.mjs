export const IDTA_02020_PROFILE_VERSION = 'idta-02020-capability-profile-v0.2.0';

export const IDTA_02020 = Object.freeze({
  submodel: 'https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0',
  capabilitySet: 'https://admin-shell.io/idta/CapabilityDescription/CapabilitySet/1/0',
  capabilityContainer: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityContainer/1/0',
  capability: 'https://admin-shell.io/idta/CapabilityDescription/Capability/1/0',
  propertySet: 'https://admin-shell.io/idta/CapabilityDescription/PropertySet/1/0',
  propertyContainer: 'https://admin-shell.io/idta/CapabilityDescription/PropertyContainer/1/0',
  sameProperty: 'https://admin-shell.io/idta/CapabilityDescription/SameProperty/1/0',
  propertyValue: 'https://admin-shell.io/idta/CapabilityPropertyType/Property/1/0',
  propertyRange: 'https://admin-shell.io/idta/CapabilityPropertyEnumType/Range/1/0',
  capabilityRelations: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRelations/1/0',
  realizedBy: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRealizedBy/1/0',
  roleRequired: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/Required/1/0',
  roleOffered: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/Offered/1/0',
  roleNotAssigned: 'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/NotAssigned/1/0',
});

const TEMPLATE_PREFIX = 'https://admin-shell.io/idta/CapabilityDescription/';
const PROPERTY_TYPE_PREFIX = 'https://admin-shell.io/idta/CapabilityProperty';
const CONTAINER_KEYS = ['value', 'submodelElements', 'statements', 'annotations'];

export function canonicalAasReference(reference) {
  const keys = Array.isArray(reference?.keys) ? reference.keys.filter((key) => key?.value) : [];
  if (keys.length === 0) return null;
  if (keys.length === 1) return String(keys[0].value);
  return keys.map((key) => `${key.type ?? 'Key'}:${key.value}`).join('>');
}

function semanticIdOf(node) {
  return canonicalAasReference(node?.semanticId);
}

function isTemplateSemantic(value) {
  return typeof value === 'string' && (value.startsWith(TEMPLATE_PREFIX) || value.startsWith(PROPERTY_TYPE_PREFIX));
}

function directChildren(node) {
  const out = [];
  for (const key of CONTAINER_KEYS) {
    if (Array.isArray(node?.[key])) out.push(...node[key].filter((item) => item && typeof item === 'object'));
  }
  return out;
}

function bySemanticOrIdShort(nodes, semanticId, idShort) {
  return nodes.filter((node) => semanticIdOf(node) === semanticId || node?.idShort === idShort);
}

function explicitRoleValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'selected', 'active'].includes(normalized);
}

export function resolveCapabilityRole(capability) {
  const roleDefs = [
    ['offered', IDTA_02020.roleOffered, 'Offered'],
    ['required', IDTA_02020.roleRequired, 'Required'],
    ['not_assigned', IDTA_02020.roleNotAssigned, 'NotAssigned'],
  ];
  const matches = [];
  for (const qualifier of capability?.qualifiers ?? []) {
    const semantic = canonicalAasReference(qualifier?.semanticId);
    for (const [role, uri, type] of roleDefs) {
      if (semantic === uri || qualifier?.type === type) matches.push({ role, explicit: explicitRoleValue(qualifier?.value) });
    }
  }
  const explicit = [...new Set(matches.filter((item) => item.explicit).map((item) => item.role))];
  if (explicit.length === 1) return { status: 'resolved', role: explicit[0], reason: 'explicit_role_selection' };
  const present = [...new Set(matches.map((item) => item.role))];
  if (present.length === 1) return { status: 'resolved', role: present[0], reason: 'single_role_qualifier' };
  return { status: 'review_required', role: null, reason: present.length > 1 ? 'ambiguous_capability_role' : 'missing_capability_role' };
}

function domainCapabilitySemanticId(capability) {
  const primary = semanticIdOf(capability);
  if (primary && primary !== IDTA_02020.capability && !isTemplateSemantic(primary)) return primary;
  const supplemental = (capability?.supplementalSemanticIds ?? []).map(canonicalAasReference).filter(Boolean);
  return supplemental.find((item) => !isTemplateSemantic(item)) ?? null;
}

function referenceSemanticFromPropertyContainer(container) {
  const sameProperty = bySemanticOrIdShort(directChildren(container), IDTA_02020.sameProperty, 'SameProperty')[0];
  const linked = canonicalAasReference(sameProperty?.second);
  if (linked) return linked;

  for (const element of directChildren(container)) {
    const semantic = semanticIdOf(element);
    if (semantic && !isTemplateSemantic(semantic)) return semantic;
    const supplemental = (element?.supplementalSemanticIds ?? []).map(canonicalAasReference).filter(Boolean);
    const domain = supplemental.find((item) => !isTemplateSemantic(item));
    if (domain) return domain;
  }
  return null;
}

function conceptDescriptionIndex(conceptDescriptions = []) {
  return new Map(conceptDescriptions.filter((item) => item?.id).map((item) => [String(item.id), item]));
}

function iec61360Unit(conceptDescription) {
  for (const embedded of conceptDescription?.embeddedDataSpecifications ?? []) {
    const content = embedded?.dataSpecificationContent;
    if (!content || typeof content !== 'object') continue;
    const unit = typeof content.unit === 'string' && content.unit.trim() ? content.unit.trim() : null;
    const unitId = canonicalAasReference(content.unitId);
    if (unit || unitId) return { unit, unitId, dataType: content.dataType ?? null, source: 'concept_description' };
  }
  return { unit: null, unitId: null, dataType: null, source: null };
}

function explicitUnit(element, container, semanticId, conceptIndex) {
  const inlineUnit = typeof element?.unit === 'string' && element.unit.trim() ? element.unit.trim() : null;
  const inlineUnitId = canonicalAasReference(element?.unitId);
  if (inlineUnit || inlineUnitId) return { unit: inlineUnit, unitId: inlineUnitId, source: 'element' };

  const qualifiers = [...(element?.qualifiers ?? []), ...(container?.qualifiers ?? [])];
  const unitQualifier = qualifiers.find((q) => String(q?.type ?? '').trim().toLowerCase() === 'unit' && q?.value != null);
  const unitIdQualifier = qualifiers.find((q) => String(q?.type ?? '').trim().toLowerCase() === 'unitid' && q?.value != null);
  if (unitQualifier || unitIdQualifier) {
    return {
      unit: unitQualifier ? String(unitQualifier.value) : null,
      unitId: unitIdQualifier ? String(unitIdQualifier.value) : null,
      source: 'qualifier',
    };
  }
  return iec61360Unit(conceptIndex.get(semanticId));
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

function numericRange(range) {
  const min = Number(range?.min);
  const max = Number(range?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return { min, max };
}

function extractProperties(container, conceptIndex) {
  const propertySets = bySemanticOrIdShort(directChildren(container), IDTA_02020.propertySet, 'PropertySet');
  const properties = [];
  const review = [];

  for (const propertySet of propertySets) {
    const propertyContainers = bySemanticOrIdShort(directChildren(propertySet), IDTA_02020.propertyContainer, 'PropertyContainer');
    for (const propertyContainer of propertyContainers) {
      const semanticId = referenceSemanticFromPropertyContainer(propertyContainer);
      const values = directChildren(propertyContainer);
      const scalar = values.find((item) => item?.modelType === 'Property' && (semanticIdOf(item) === IDTA_02020.propertyValue || item?.idShort === 'PropertyProperty'));
      const range = values.find((item) => item?.modelType === 'Range' && (semanticIdOf(item) === IDTA_02020.propertyRange || item?.idShort === 'PropertyRange'));

      if (!semanticId) {
        review.push({ idShort: propertyContainer?.idShort ?? null, reason: 'missing_domain_property_semantic' });
        continue;
      }

      if (scalar) {
        const value = scalarValue(scalar);
        const unit = explicitUnit(scalar, propertyContainer, semanticId, conceptIndex);
        if (value == null) {
          review.push({ semanticId, reason: 'unsupported_or_invalid_property_value' });
          continue;
        }
        const eligible = Boolean(unit.unit || unit.unitId);
        properties.push({ semanticId, kind: 'scalar', value, unit: unit.unit, unitId: unit.unitId, unitSource: unit.source, matchingStatus: eligible ? 'eligible' : 'review_required' });
        if (!eligible) review.push({ semanticId, reason: 'missing_explicit_or_semantic_unit' });
        continue;
      }

      if (range) {
        const parsed = numericRange(range);
        const unit = explicitUnit(range, propertyContainer, semanticId, conceptIndex);
        if (!parsed) {
          review.push({ semanticId, reason: 'invalid_property_range', min: range?.min ?? null, max: range?.max ?? null });
          continue;
        }
        const eligible = Boolean(unit.unit || unit.unitId);
        properties.push({ semanticId, kind: 'range', min: parsed.min, max: parsed.max, unit: unit.unit, unitId: unit.unitId, unitSource: unit.source, matchingStatus: eligible ? 'eligible' : 'review_required' });
        if (!eligible) review.push({ semanticId, reason: 'missing_explicit_or_semantic_unit' });
        continue;
      }

      review.push({ semanticId, reason: 'unsupported_property_representation' });
    }
  }
  return { properties, review };
}

function extractTechnicalSkillRefs(container) {
  const relationSets = bySemanticOrIdShort(directChildren(container), IDTA_02020.capabilityRelations, 'CapabilityRelations');
  const refs = [];
  for (const relations of relationSets) {
    for (const relation of directChildren(relations)) {
      if (semanticIdOf(relation) !== IDTA_02020.realizedBy && relation?.idShort !== 'CapabilityRealizedBy') continue;
      const target = canonicalAasReference(relation?.second);
      if (target) refs.push(target);
    }
  }
  return [...new Set(refs)];
}

function walkContainers(root, { maxElements, maxDepth }) {
  const found = [];
  let visited = 0;
  const stack = directChildren(root).map((node) => ({ node, depth: 0 })).reverse();
  while (stack.length) {
    const { node, depth } = stack.pop();
    visited += 1;
    if (visited > maxElements) return { status: 'rejected', reason: 'aas_element_limit_exceeded', found: [], visited };
    if (depth > maxDepth) return { status: 'rejected', reason: 'aas_depth_limit_exceeded', found: [], visited };
    if (semanticIdOf(node) === IDTA_02020.capabilityContainer || node?.idShort === 'CapabilityContainer') found.push(node);
    for (const child of directChildren(node).reverse()) stack.push({ node: child, depth: depth + 1 });
  }
  return { status: 'accepted', found, visited };
}

export function isIdta02020CapabilitySubmodel(submodel) {
  return canonicalAasReference(submodel?.semanticId) === IDTA_02020.submodel;
}

export function extractIdta02020CapabilityProfile(submodels = [], { maxElements = 10_000, maxDepth = 12, conceptDescriptions = [] } = {}) {
  const offered = [];
  const required = [];
  const notAssigned = [];
  const reviewRequired = [];
  let visitedElements = 0;
  let matchedSubmodels = 0;
  const conceptIndex = conceptDescriptionIndex(conceptDescriptions);

  for (const submodel of submodels) {
    if (!isIdta02020CapabilitySubmodel(submodel)) continue;
    matchedSubmodels += 1;
    const walked = walkContainers(submodel, { maxElements: Math.max(1, maxElements - visitedElements), maxDepth });
    if (walked.status !== 'accepted') return { status: 'rejected', reason: walked.reason, offered: [], required: [], notAssigned: [], reviewRequired: [] };
    visitedElements += walked.visited;

    for (const container of walked.found) {
      const capabilities = directChildren(container).filter((item) => item?.modelType === 'Capability');
      if (capabilities.length !== 1) {
        reviewRequired.push({ submodelId: submodel?.id ?? null, containerIdShort: container?.idShort ?? null, reason: capabilities.length === 0 ? 'missing_capability_element' : 'multiple_capability_elements' });
        continue;
      }
      const capability = capabilities[0];
      const role = resolveCapabilityRole(capability);
      const semanticId = domainCapabilitySemanticId(capability);
      const { properties, review } = extractProperties(container, conceptIndex);
      const entry = {
        label: capability?.idShort ?? container?.idShort ?? 'Unmapped IDTA capability',
        semanticId,
        role: role.role,
        source: 'aas-idta-02020',
        properties,
        technicalSkillRefs: extractTechnicalSkillRefs(container),
        evidence: {
          profileVersion: IDTA_02020_PROFILE_VERSION,
          submodelId: submodel?.id ?? null,
          submodelSemanticId: IDTA_02020.submodel,
          containerIdShort: container?.idShort ?? null,
          capabilityIdShort: capability?.idShort ?? null,
          propertyReview: review,
        },
      };

      if (role.status !== 'resolved' || !semanticId) {
        reviewRequired.push({ ...entry, reason: role.status !== 'resolved' ? role.reason : 'missing_domain_capability_semantic' });
        continue;
      }
      if (role.role === 'offered') offered.push(entry);
      else if (role.role === 'required') required.push(entry);
      else notAssigned.push(entry);
    }
  }

  return { status: 'accepted', matchedSubmodels, visitedElements, offered, required, notAssigned, reviewRequired };
}

export function benchmarkIdtaConfiguration(profileResult) {
  const represented = (profileResult?.offered?.length ?? 0) + (profileResult?.required?.length ?? 0) + (profileResult?.notAssigned?.length ?? 0);
  const reviewRequired = profileResult?.reviewRequired?.length ?? 0;
  const total = represented + reviewRequired;
  return {
    totalCapabilityContainers: total,
    representedWithoutManualRoleOrSemanticRepair: represented,
    reviewRequired,
    representationPct: total === 0 ? 0 : represented / total,
    repeatedConfigurationReductionPct: total === 0 ? 0 : 1 - (reviewRequired / total),
  };
}
