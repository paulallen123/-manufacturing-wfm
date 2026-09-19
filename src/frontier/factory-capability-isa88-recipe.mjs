export const ISA88_RECIPE_CAPABILITY_VERSION = 'factory-capability-isa88-recipe-v0.1.0';

const NUMERIC_TYPES = /(^|:)(byte|short|int|integer|long|float|double|decimal|nonnegativeinteger|positiveinteger)$/i;
const BOOLEAN_TYPES = /(^|:)boolean$/i;

function asObjectMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTypedValue(parameter) {
  const raw = parameter?.ValueString;
  if (raw == null) return { status: 'rejected', reason: 'parameter_value_missing' };
  const type = String(parameter?.DataType ?? '').trim();
  if (NUMERIC_TYPES.test(type)) {
    const value = Number(raw);
    return Number.isFinite(value)
      ? { status: 'accepted', value }
      : { status: 'rejected', reason: 'invalid_numeric_parameter_value' };
  }
  if (BOOLEAN_TYPES.test(type)) {
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'true') return { status: 'accepted', value: true };
    if (normalized === 'false') return { status: 'accepted', value: false };
    return { status: 'rejected', reason: 'invalid_boolean_parameter_value' };
  }
  if (!type || /string$/i.test(type)) return { status: 'accepted', value: String(raw) };
  return { status: 'rejected', reason: 'unsupported_parameter_datatype' };
}

function collectNodes(recipe) {
  const groups = [
    ['input', recipe?.Inputs],
    ['output', recipe?.Outputs],
    ['intermediate', recipe?.Intermediates],
    ['process', recipe?.ProcessElements],
  ];
  const nodes = [];
  const seen = new Set();
  for (const [kind, items] of groups) {
    if (items == null) continue;
    if (!Array.isArray(items)) return { status: 'rejected', reason: `invalid_${kind}_collection` };
    for (const item of items) {
      const id = item?.ID != null ? String(item.ID) : null;
      if (!id) return { status: 'rejected', reason: 'recipe_node_missing_id' };
      if (seen.has(id)) return { status: 'rejected', reason: 'duplicate_recipe_node_id', nodeId: id };
      seen.add(id);
      nodes.push({ id, kind, item, order: nodes.length });
    }
  }
  return { status: 'accepted', nodes };
}

function topologicalProcessOrder(recipe, nodes, maxLinks) {
  const links = recipe?.DirectedLinks;
  if (!Array.isArray(links) || links.length === 0) return { status: 'rejected', reason: 'directed_links_required' };
  if (links.length > maxLinks) return { status: 'rejected', reason: 'recipe_link_limit_exceeded' };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const seenLinkIds = new Set();

  for (const link of links) {
    const linkId = link?.ID != null ? String(link.ID) : null;
    if (!linkId) return { status: 'rejected', reason: 'directed_link_missing_id' };
    if (seenLinkIds.has(linkId)) return { status: 'rejected', reason: 'duplicate_directed_link_id', linkId };
    seenLinkIds.add(linkId);
    const from = link?.FromID != null ? String(link.FromID) : null;
    const to = link?.ToID != null ? String(link.ToID) : null;
    if (!from || !to || !nodeById.has(from) || !nodeById.has(to)) {
      return { status: 'rejected', reason: 'directed_link_unknown_endpoint', linkId, from, to };
    }
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }

  const orderOf = (id) => nodeById.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id).sort((a, b) => orderOf(a) - orderOf(b));
  const ordered = [];
  while (queue.length) {
    const current = queue.shift();
    ordered.push(current);
    const targets = [...outgoing.get(current)].sort((a, b) => orderOf(a) - orderOf(b));
    for (const target of targets) {
      const next = indegree.get(target) - 1;
      indegree.set(target, next);
      if (next === 0) {
        queue.push(target);
        queue.sort((a, b) => orderOf(a) - orderOf(b));
      }
    }
  }
  if (ordered.length !== nodes.length) return { status: 'rejected', reason: 'recipe_flow_cycle_detected' };
  return { status: 'accepted', processIds: ordered.filter((id) => nodeById.get(id)?.kind === 'process') };
}

function constraintFromParameter(parameter, mapping) {
  if (mapping?.kind === 'non_capability') {
    return { status: 'ignored', reason: mapping.reason ?? 'explicitly_classified_non_capability_parameter' };
  }
  if (mapping?.kind !== 'constraint' || !mapping.semanticId || !mapping.operator) {
    return { status: 'review_required', reason: 'parameter_mapping_missing_or_incomplete' };
  }
  const parsed = parseTypedValue(parameter);
  if (parsed.status !== 'accepted') return { status: 'review_required', reason: parsed.reason };
  const unitId = parameter?.UnitOfMeasure != null ? String(parameter.UnitOfMeasure) : null;
  const unitAliases = asObjectMap(mapping.unitAliases);
  const unit = unitId && unitAliases[unitId] != null ? String(unitAliases[unitId]) : null;
  if (mapping.requireUnit === true && !unit && !unitId) return { status: 'review_required', reason: 'required_parameter_unit_missing' };
  if (mapping.allowedUnitIds && (!unitId || !mapping.allowedUnitIds.includes(unitId))) {
    return { status: 'review_required', reason: 'parameter_unit_not_allowlisted' };
  }
  return {
    status: 'accepted',
    constraint: {
      semanticId: String(mapping.semanticId),
      operator: String(mapping.operator),
      value: parsed.value,
      ...(unit ? { unit } : {}),
      ...(unitId ? { unitId } : {}),
    },
  };
}

export function extractIsa88CapabilitySteps(recipe, {
  capabilityMappings = {},
  minimumQualifiedPeopleByCapability = {},
  maxProcessElements = 1_000,
  maxLinks = 5_000,
} = {}) {
  if (!recipe || typeof recipe !== 'object' || !recipe.ID) return { status: 'rejected', reason: 'invalid_or_unidentified_general_recipe' };
  const collected = collectNodes(recipe);
  if (collected.status !== 'accepted') return collected;
  const processNodes = collected.nodes.filter((node) => node.kind === 'process');
  if (processNodes.length === 0) return { status: 'rejected', reason: 'process_elements_required' };
  if (processNodes.length > maxProcessElements) return { status: 'rejected', reason: 'process_element_limit_exceeded' };

  const topology = topologicalProcessOrder(recipe, collected.nodes, maxLinks);
  if (topology.status !== 'accepted') return topology;
  const processById = new Map(processNodes.map((node) => [node.id, node.item]));
  const mappings = asObjectMap(capabilityMappings);
  const staffing = asObjectMap(minimumQualifiedPeopleByCapability);
  const steps = [];
  const reviewRequired = [];

  for (const processId of topology.processIds) {
    const element = processById.get(processId);
    const semanticDescription = element?.SemanticDescription != null ? String(element.SemanticDescription) : null;
    const capabilityMapping = semanticDescription ? mappings[semanticDescription] : null;
    if (!capabilityMapping?.capabilityId) {
      reviewRequired.push({ processElementId: processId, semanticDescription, reason: 'capability_mapping_required' });
      continue;
    }

    const constraints = [];
    const parameterReviews = [];
    const parameterMappings = asObjectMap(capabilityMapping.parameters);
    const parameters = Array.isArray(element?.Parameters) ? element.Parameters : [];
    if (element?.Parameters != null && !Array.isArray(element.Parameters)) {
      reviewRequired.push({ processElementId: processId, semanticDescription, reason: 'invalid_parameter_collection' });
      continue;
    }

    for (const parameter of parameters) {
      const key = parameter?.Key != null ? String(parameter.Key) : null;
      const mapping = key ? parameterMappings[key] : null;
      if (!mapping) {
        parameterReviews.push({ parameterId: parameter?.ID ?? null, key, reason: 'parameter_classification_required' });
        continue;
      }
      const classified = constraintFromParameter(parameter, mapping);
      if (classified.status === 'accepted') constraints.push(classified.constraint);
      else if (classified.status === 'review_required') {
        parameterReviews.push({ parameterId: parameter?.ID ?? null, key, reason: classified.reason });
      }
    }

    if (parameterReviews.length) {
      reviewRequired.push({ processElementId: processId, semanticDescription, reason: 'parameter_review_required', parameters: parameterReviews });
      continue;
    }

    const capabilityId = String(capabilityMapping.capabilityId);
    const minimumQualifiedPeople = finitePositive(staffing[capabilityId] ?? capabilityMapping.minimumQualifiedPeople ?? 1);
    if (minimumQualifiedPeople == null) {
      reviewRequired.push({ processElementId: processId, semanticDescription, reason: 'invalid_minimum_qualified_people' });
      continue;
    }
    steps.push({
      stepId: processId,
      label: element?.Description ?? processId,
      requirement: { capabilityId, constraints },
      minimumQualifiedPeople,
      evidence: {
        recipeId: String(recipe.ID),
        semanticDescription,
        adapterVersion: ISA88_RECIPE_CAPABILITY_VERSION,
      },
    });
  }

  return {
    status: reviewRequired.length ? 'review_required' : 'accepted',
    recipeId: String(recipe.ID),
    steps,
    reviewRequired,
    processOrder: [...topology.processIds],
    authorityBoundary: 'Recipe semantics become advisory capability requirements only through explicit allow-listed mappings. This adapter cannot publish a production plan, assign workers, change payroll, or actuate equipment.',
    version: ISA88_RECIPE_CAPABILITY_VERSION,
  };
}
