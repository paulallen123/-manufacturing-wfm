export const COVERAGE_KINDS=Object.freeze({
  COMPLETE_SNAPSHOT:'complete-snapshot',
  INCREMENTAL_DELTA:'incremental-delta',
  SPARSE_PROJECTION:'sparse-projection',
  AGGREGATE_PROJECTION:'aggregate-projection',
  EVENT_SIGNAL:'event-signal'
});

const VALID_KINDS=new Set(Object.values(COVERAGE_KINDS));

function text(value,name){
  if(typeof value!=='string'||!value.trim()) throw new Error(name+' must be a non-empty string');
  return value.trim();
}

export function normalizeDatasetCoverage(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('dataset coverage must be an object');
  const kind=text(input.kind,'kind');
  if(!VALID_KINDS.has(kind)) throw new Error('unsupported dataset coverage kind: '+kind);
  const absenceMeaning=text(input.absenceMeaning,'absenceMeaning');
  return {
    dataset:text(input.dataset,'dataset'),
    kind,
    absenceMeaning,
    entityUniverse:input.entityUniverse?text(input.entityUniverse,'entityUniverse'):null,
    scopeProven:input.scopeProven===true,
    pageComplete:input.pageComplete===true,
    reconciliationComplete:input.reconciliationComplete===true,
    authoritativeForExistence:input.authoritativeForExistence===true,
    freshnessSeconds:Number.isFinite(input.freshnessSeconds)&&input.freshnessSeconds>=0?input.freshnessSeconds:null
  };
}

export function missingRecordDisposition(input){
  const coverage=normalizeDatasetCoverage(input);
  const deletable=coverage.kind===COVERAGE_KINDS.COMPLETE_SNAPSHOT
    && coverage.authoritativeForExistence
    && coverage.scopeProven
    && coverage.pageComplete
    && coverage.reconciliationComplete;
  return deletable?'tombstone-candidate':'do-not-delete';
}

export function reconciliationRequirements(input){
  const coverage=normalizeDatasetCoverage(input);
  return {
    deletionBlocked:missingRecordDisposition(coverage)!=='tombstone-candidate',
    overlapReplayRequired:coverage.kind===COVERAGE_KINDS.INCREMENTAL_DELTA||coverage.kind===COVERAGE_KINDS.EVENT_SIGNAL,
    stableIdDedupeRequired:coverage.kind!==COVERAGE_KINDS.AGGREGATE_PROJECTION,
    fullSnapshotRequiredForExistenceProof:coverage.kind!==COVERAGE_KINDS.COMPLETE_SNAPSHOT,
    scopeProofRequired:!coverage.scopeProven,
    pageCompletionRequired:coverage.kind===COVERAGE_KINDS.COMPLETE_SNAPSHOT&&!coverage.pageComplete,
    reconciliationRequired:!coverage.reconciliationComplete
  };
}

export function assertSafeTombstoneInference(input){
  const coverage=normalizeDatasetCoverage(input);
  if(missingRecordDisposition(coverage)!=='tombstone-candidate'){
    throw new Error('missing records cannot imply deletion for '+coverage.dataset+' ('+coverage.kind+') until authoritative scope, page completeness and reconciliation are proven');
  }
  return coverage;
}
