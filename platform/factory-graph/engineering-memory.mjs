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

function normalizeTokens(tokens) {
  assert(Array.isArray(tokens), 'searchTokens must be an array');
  return [...new Set(tokens.map((token) => String(token).trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizeVector(vector, label) {
  if (vector === undefined || vector === null) return null;
  assert(Array.isArray(vector) && vector.length > 0, `${label} must be a non-empty array when supplied`);
  const normalized = vector.map((value, index) => {
    assert(Number.isFinite(value), `${label}[${index}] must be finite`);
    return Number(value);
  });
  const magnitude = Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0));
  assert(magnitude > 0, `${label} must not be a zero vector`);
  return normalized;
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return null;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

function cosine(a, b) {
  if (!a || !b) return null;
  assert(a.length === b.length, 'comparable vectors must have equal dimensions');
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    left += a[i] * a[i];
    right += b[i] * b[i];
  }
  if (left === 0 || right === 0) return null;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(left) * Math.sqrt(right))));
}

function exactSignal(left, right) {
  if (!left || !right) return null;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase() ? 1 : 0;
}

function weightedScore(signals, weights) {
  let weighted = 0;
  let availableWeight = 0;
  for (const [name, value] of Object.entries(signals)) {
    if (value === null || value === undefined) continue;
    const weight = weights[name] ?? 0;
    weighted += value * weight;
    availableWeight += weight;
  }
  assert(availableWeight > 0, 'no comparable evidence-backed similarity signals are available');
  return Math.round((weighted / availableWeight) * 10000) / 10000;
}

export function buildEngineeringMemory({ records = [], weights = {} } = {}) {
  const effectiveWeights = Object.freeze({
    text: weights.text ?? 0.20,
    engineering: weights.engineering ?? 0.30,
    geometry: weights.geometry ?? 0.35,
    material: weights.material ?? 0.10,
    process: weights.process ?? 0.05
  });
  const recordsById = new Map();

  for (const input of records) {
    assert(input && typeof input === 'object', 'engineering record must be an object');
    assert(typeof input.id === 'string' && input.id.length > 0, 'engineering record.id is required');
    assert(typeof input.partId === 'string' && input.partId.length > 0, `record:${input.id}.partId is required`);
    assert(typeof input.revision === 'string' && input.revision.length > 0, `record:${input.id}.revision is required`);
    if (input.tenant !== undefined || input.site !== undefined) {
      assert(typeof input.tenant === 'string' && input.tenant.length > 0 &&
        typeof input.site === 'string' && input.site.length > 0,
      `record:${input.id} needs both tenant and site`);
    }
    assert(!recordsById.has(input.id), `duplicate engineering record id: ${input.id}`);
    validateEvidence(input.evidence, `record:${input.id}`);
    const record = Object.freeze({
      ...input,
      evidence: Object.freeze({ ...input.evidence }),
      searchTokens: Object.freeze(normalizeTokens(input.searchTokens ?? [])),
      engineeringVector: Object.freeze(normalizeVector(input.engineeringVector, `record:${input.id}.engineeringVector`) ?? []),
      geometryVector: Object.freeze(normalizeVector(input.geometryVector, `record:${input.id}.geometryVector`) ?? [])
    });
    recordsById.set(record.id, record);
  }

  for (const record of recordsById.values()) {
    if (!record.previousRevisionId) continue;
    const previous = recordsById.get(record.previousRevisionId);
    assert(previous, `record:${record.id}.previousRevisionId does not exist`);
    assert(previous.id !== record.id, `record:${record.id} cannot revise itself`);
    assert(previous.partId === record.partId, `record:${record.id} revision lineage must stay on the same part`);
    assert(previous.tenant === record.tenant && previous.site === record.site,
      `record:${record.id} revision lineage must stay in the same tenant and site`);
  }

  function compare(left, right) {
    assert(left && right, 'two engineering records are required');
    const signals = Object.freeze({
      text: jaccard(left.searchTokens, right.searchTokens),
      engineering: cosine(left.engineeringVector.length ? left.engineeringVector : null, right.engineeringVector.length ? right.engineeringVector : null),
      geometry: cosine(left.geometryVector.length ? left.geometryVector : null, right.geometryVector.length ? right.geometryVector : null),
      material: exactSignal(left.material, right.material),
      process: exactSignal(left.process, right.process)
    });
    return Object.freeze({
      recordId: right.id,
      partId: right.partId,
      revision: right.revision,
      score: weightedScore(signals, effectiveWeights),
      signals,
      evidenceRefs: Object.freeze([left.evidence.sourceRef, right.evidence.sourceRef]),
      claimBoundary: 'Similarity is based only on supplied evidence-backed features. This module does not extract OCR, GD&T or geometry from source files.'
    });
  }

  return Object.freeze({
    records: Object.freeze([...recordsById.values()]),
    recordById(id) { return recordsById.get(id) ?? null; },
    revisionChain(id) {
      const chain = [];
      const seen = new Set();
      let current = recordsById.get(id) ?? null;
      while (current) {
        assert(!seen.has(current.id), `revision cycle detected at ${current.id}`);
        seen.add(current.id);
        chain.push(current);
        current = current.previousRevisionId ? recordsById.get(current.previousRevisionId) ?? null : null;
      }
      return Object.freeze(chain);
    },
    similarTo(id, { limit = 10, minimumScore = 0, excludeSamePart = true } = {}) {
      const query = recordsById.get(id);
      assert(query, `unknown engineering record: ${id}`);
      assert(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer');
      assert(Number.isFinite(minimumScore) && minimumScore >= 0 && minimumScore <= 1, 'minimumScore must be between 0 and 1');
      return Object.freeze([...recordsById.values()]
        .filter((candidate) => candidate.id !== id)
        .filter((candidate) => !excludeSamePart || candidate.partId !== query.partId)
        .map((candidate) => compare(query, candidate))
        .filter((candidate) => candidate.score >= minimumScore)
        .sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId))
        .slice(0, limit));
    },
    scopedSimilarTo(id, { tenant, site, allowedRecordIds, limit = 10, minimumScore = 0,
      excludeSamePart = true } = {}) {
      assert(typeof tenant === 'string' && tenant.length > 0 &&
        typeof site === 'string' && site.length > 0 && allowedRecordIds instanceof Set,
      'trusted tenant, site and allowedRecordIds are required');
      const query = recordsById.get(id);
      assert(query && query.tenant === tenant && query.site === site && allowedRecordIds.has(id),
        'engineering record not accessible');
      assert(Number.isInteger(limit) && limit > 0, 'limit must be a positive integer');
      assert(Number.isFinite(minimumScore) && minimumScore >= 0 && minimumScore <= 1,
        'minimumScore must be between 0 and 1');
      return Object.freeze([...recordsById.values()]
        .filter((candidate) => candidate.id !== id && candidate.tenant === tenant &&
          candidate.site === site && allowedRecordIds.has(candidate.id))
        .filter((candidate) => !excludeSamePart || candidate.partId !== query.partId)
        .map((candidate) => compare(query, candidate))
        .filter((candidate) => candidate.score >= minimumScore)
        .sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId))
        .slice(0, limit));
    }
  });
}
