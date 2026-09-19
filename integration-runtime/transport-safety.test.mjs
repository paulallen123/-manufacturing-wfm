import assert from 'node:assert/strict';
import { transportSafetyRequirements, validateTransportSafetyEvidence } from './transport-safety.mjs';

function profile(kind) {
  return { transport: { kind } };
}

function baseEvidence(kind, observedControls, overrides = {}) {
  return {
    transportSafety: {
      transportKind: kind,
      observedControls,
      mutationObserved: false,
      scopeExceeded: false,
      ...overrides
    }
  };
}

const fileControls = transportSafetyRequirements('sftp');
assert.deepEqual(fileControls, [
  'endpoint_identity',
  'read_only_source',
  'path_allowlist',
  'stable_object_identity',
  'complete_object_observed'
]);

const incompleteFile = validateTransportSafetyEvidence(
  profile('sftp'),
  baseEvidence('sftp', fileControls, {
    sourceObjectChanged: false,
    pathAllowlistObserved: true,
    stableObjectIdentityObserved: true,
    completeObjectObserved: false
  })
);
assert.match(incompleteFile.join('\n'), /incomplete or still-changing source objects/);

const unsafeIdentity = validateTransportSafetyEvidence(
  profile('https_file'),
  baseEvidence('https_file', transportSafetyRequirements('https_file'), {
    sourceObjectChanged: false,
    pathAllowlistObserved: true,
    stableObjectIdentityObserved: false,
    completeObjectObserved: true
  })
);
assert.match(unsafeIdentity.join('\n'), /stable source-object identity/);

const safeFile = validateTransportSafetyEvidence(
  profile('sftp'),
  baseEvidence('sftp', fileControls, {
    sourceObjectChanged: false,
    pathAllowlistObserved: true,
    stableObjectIdentityObserved: true,
    completeObjectObserved: true
  })
);
assert.deepEqual(safeFile, []);

const dbControls = transportSafetyRequirements('readonly_database');
assert.deepEqual(dbControls, [
  'endpoint_identity',
  'read_only_session',
  'select_only_plan',
  'consistent_read_snapshot',
  'statement_timeout'
]);

const weakDb = validateTransportSafetyEvidence(
  profile('readonly_database'),
  baseEvidence('readonly_database', dbControls, {
    sessionReadOnly: true,
    queryPlanClass: 'select_only',
    writeAttempted: false,
    consistentReadSnapshotObserved: false,
    statementTimeoutObserved: false
  })
);
assert.match(weakDb.join('\n'), /consistent read snapshot/);
assert.match(weakDb.join('\n'), /bounded statement timeout/);

const safeDb = validateTransportSafetyEvidence(
  profile('readonly_database'),
  baseEvidence('readonly_database', dbControls, {
    sessionReadOnly: true,
    queryPlanClass: 'select_only',
    writeAttempted: false,
    consistentReadSnapshotObserved: true,
    statementTimeoutObserved: true
  })
);
assert.deepEqual(safeDb, []);

console.log('transport safety secure-file/database regression passed');
