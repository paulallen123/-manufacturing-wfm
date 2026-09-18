export const CAPABILITY_HIERARCHY_VERSION = 'factory-capability-hierarchy-v0.1.0';

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildApprovedCapabilityHierarchy(relations = [], { maxEdges = 10_000 } = {}) {
  if (!Array.isArray(relations)) return { status: 'rejected', reason: 'invalid_relation_set' };
  if (relations.length > maxEdges) return { status: 'rejected', reason: 'capability_relation_limit_exceeded' };

  const parents = new Map();
  const accepted = [];
  const ignored = [];

  for (const relation of relations) {
    const child = relation?.childCapabilityId ?? relation?.specificCapabilityId ?? null;
    const parent = relation?.parentCapabilityId ?? relation?.generalCapabilityId ?? null;
    if (relation?.approvalStatus !== 'approved') {
      ignored.push({ childCapabilityId: child, parentCapabilityId: parent, reason: 'relation_not_approved' });
      continue;
    }
    if (!validId(child) || !validId(parent)) {
      ignored.push({ childCapabilityId: child, parentCapabilityId: parent, reason: 'missing_capability_identity' });
      continue;
    }
    if (child === parent) {
      return { status: 'rejected', reason: 'self_generalization', childCapabilityId: child };
    }
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
    accepted.push({ childCapabilityId: child, parentCapabilityId: parent, source: relation?.source ?? null });
  }

  return { status: 'accepted', parents, accepted, ignored };
}

export function resolveCapabilitySubsumption(providedCapabilityId, requiredCapabilityId, relations = [], { maxDepth = 16 } = {}) {
  if (!validId(providedCapabilityId) || !validId(requiredCapabilityId)) {
    return { status: 'review_required', reason: 'missing_capability_identity', path: [] };
  }
  if (providedCapabilityId === requiredCapabilityId) {
    return { status: 'match', reason: 'exact_capability_match', path: [providedCapabilityId] };
  }

  const hierarchy = buildApprovedCapabilityHierarchy(relations);
  if (hierarchy.status !== 'accepted') return { status: 'review_required', reason: hierarchy.reason, path: [] };

  const queue = [{ id: providedCapabilityId, path: [providedCapabilityId], depth: 0 }];
  const bestDepth = new Map([[providedCapabilityId, 0]]);
  let cycleObserved = false;

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      return { status: 'review_required', reason: 'capability_hierarchy_depth_limit', path: current.path };
    }
    for (const parent of hierarchy.parents.get(current.id) ?? []) {
      if (current.path.includes(parent)) {
        cycleObserved = true;
        continue;
      }
      const path = [...current.path, parent];
      if (parent === requiredCapabilityId) {
        return { status: 'match', reason: 'approved_generalization_match', path };
      }
      const depth = current.depth + 1;
      if ((bestDepth.get(parent) ?? Infinity) <= depth) continue;
      bestDepth.set(parent, depth);
      queue.push({ id: parent, path, depth });
    }
  }

  if (cycleObserved) return { status: 'review_required', reason: 'capability_hierarchy_cycle', path: [] };
  return { status: 'no_match', reason: 'no_approved_generalization_path', path: [] };
}
