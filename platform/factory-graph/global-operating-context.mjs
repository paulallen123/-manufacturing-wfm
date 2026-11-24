function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateLocale(locale, label) {
  if (locale === undefined) return;
  assert(typeof locale === 'string' && locale.length > 0, `${label}.locale must be a non-empty string`);
  try {
    Intl.getCanonicalLocales(locale);
  } catch {
    throw new Error(`${label}.locale is invalid: ${locale}`);
  }
}

function validateTimeZone(timeZone, label) {
  if (timeZone === undefined) return;
  assert(typeof timeZone === 'string' && timeZone.length > 0, `${label}.timeZone must be a non-empty string`);
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
  } catch {
    throw new Error(`${label}.timeZone is invalid: ${timeZone}`);
  }
}

function validateCurrency(currency, label) {
  if (currency === undefined) return;
  assert(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency), `${label}.currency must be a 3-letter uppercase code`);
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency }).format(1);
  } catch {
    throw new Error(`${label}.currency is invalid: ${currency}`);
  }
}

function validateCountryCode(countryCode, label) {
  if (countryCode === undefined) return;
  assert(typeof countryCode === 'string' && /^[A-Z]{2}$/.test(countryCode), `${label}.countryCode must be a 2-letter uppercase code`);
}

function validateContext(context, label) {
  if (context === undefined) return Object.freeze({});
  assert(context && typeof context === 'object' && !Array.isArray(context), `${label}.globalContext must be an object`);
  validateLocale(context.locale, label);
  validateTimeZone(context.timeZone, label);
  validateCurrency(context.currency, label);
  validateCountryCode(context.countryCode, label);
  if (context.dataRegion !== undefined) assert(typeof context.dataRegion === 'string' && context.dataRegion.length > 0, `${label}.dataRegion must be a non-empty string`);
  if (context.unitSystem !== undefined) assert(['metric', 'imperial', 'mixed'].includes(context.unitSystem), `${label}.unitSystem must be metric, imperial or mixed`);
  return Object.freeze({ ...context });
}

function activeAt(relation, atMs) {
  return (!relation.validFrom || Date.parse(relation.validFrom) <= atMs) &&
    (!relation.validTo || atMs <= Date.parse(relation.validTo));
}

export function buildGlobalOperatingContext(graph, { defaultContext = {} } = {}) {
  assert(graph && Array.isArray(graph.entities) && Array.isArray(graph.relations) && typeof graph.entityById === 'function', 'factory graph is required');
  const defaults = validateContext(defaultContext, 'defaultContext');
  const contextByEntity = new Map();
  const parentByChild = new Map();

  for (const entity of graph.entities) {
    contextByEntity.set(entity.id, validateContext(entity.globalContext, `entity:${entity.id}`));
  }

  for (const relation of graph.relations) {
    if (relation.type !== 'PARENT_OF') continue;
    assert(!parentByChild.has(relation.to), `entity:${relation.to} has multiple PARENT_OF parents`);
    parentByChild.set(relation.to, relation.from);
  }

  function lineage(entityId) {
    assert(graph.entityById(entityId), `unknown entity: ${entityId}`);
    const chain = [];
    const seen = new Set();
    let current = entityId;
    while (current) {
      assert(!seen.has(current), `global hierarchy cycle detected at ${current}`);
      seen.add(current);
      chain.push(current);
      current = parentByChild.get(current) ?? null;
    }
    return Object.freeze(chain.reverse());
  }

  function resolveContext(entityId) {
    const ids = lineage(entityId);
    let merged = { ...defaults };
    for (const id of ids) merged = { ...merged, ...(contextByEntity.get(id) ?? {}) };
    return Object.freeze(merged);
  }

  function effectivePolicies(entityId, at) {
    assert(isIsoDate(at), 'effectivePolicies.at must be ISO date-time');
    const atMs = Date.parse(at);
    const ids = lineage(entityId);
    const chosen = new Map();
    ids.forEach((ownerId, specificity) => {
      for (const relation of graph.relations) {
        if (relation.type !== 'GOVERNED_BY' || relation.from !== ownerId || !activeAt(relation, atMs)) continue;
        const policy = graph.entityById(relation.to);
        assert(policy?.type === 'policy_set', `GOVERNED_BY target must be policy_set: ${relation.to}`);
        assert(typeof policy.policyKey === 'string' && policy.policyKey.length > 0, `policy:${policy.id}.policyKey is required`);
        const existing = chosen.get(policy.policyKey);
        if (!existing || specificity >= existing.specificity) {
          chosen.set(policy.policyKey, Object.freeze({
            policyKey: policy.policyKey,
            value: policy.value,
            policyId: policy.id,
            ownerId,
            specificity,
            evidence: policy.evidence
          }));
        }
      }
    });
    return Object.freeze(Object.fromEntries([...chosen.entries()].map(([key, value]) => [key, value])));
  }

  function localParts(entityId, instant) {
    assert(isIsoDate(instant), 'localParts.instant must be ISO date-time');
    const context = resolveContext(entityId);
    assert(context.timeZone, `entity:${entityId} has no resolved timeZone`);
    const locale = context.locale || 'en';
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: context.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      timeZoneName: 'shortOffset'
    }).formatToParts(new Date(instant));
    return Object.freeze(Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])));
  }

  return Object.freeze({ lineage, resolveContext, effectivePolicies, localParts });
}
