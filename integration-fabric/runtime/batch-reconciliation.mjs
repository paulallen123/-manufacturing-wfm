import crypto from 'node:crypto';
import {buildSourceScope,assertCheckpointScope} from './scope-partition.mjs';
import {missingRecordDisposition} from './dataset-coverage.mjs';

const WATERMARK_KINDS=new Set(['opaque','iso8601','unsigned-integer','lexical']);

function requiredString(value,name){
  if(typeof value!=='string'||!value.trim()) throw new Error(`${name} is required`);
  return value.normalize('NFC').trim();
}

function canonicalJson(value){
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object'){
    return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareWatermarks(current,previous,kind){
  if(current===null||previous===null) return Object.freeze({comparable:false,regressed:false});
  if(!WATERMARK_KINDS.has(kind)) throw new Error(`unsupported watermarkKind: ${kind}`);

  if(kind==='opaque'){
    return Object.freeze({comparable:false,regressed:false});
  }

  if(kind==='iso8601'){
    const currentEpoch=Date.parse(String(current));
    const previousEpoch=Date.parse(String(previous));
    if(!Number.isFinite(currentEpoch)||!Number.isFinite(previousEpoch)) throw new Error('iso8601 watermarks must be valid timestamps');
    return Object.freeze({comparable:true,regressed:currentEpoch<previousEpoch});
  }

  if(kind==='unsigned-integer'){
    const pattern=/^(0|[1-9]\d*)$/;
    if(!pattern.test(String(current))||!pattern.test(String(previous))) throw new Error('unsigned-integer watermarks must contain decimal digits only');
    return Object.freeze({comparable:true,regressed:BigInt(current)<BigInt(previous)});
  }

  return Object.freeze({comparable:true,regressed:String(current)<String(previous)});
}

function requiredBoolean(value,name){
  if(typeof value!=='boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

export function makeScopedExternalIdentity({provider,connector,scope={},recordId,dimensions={}}){
  const material={
    provider:requiredString(provider,'provider'),
    connector:requiredString(connector,'connector'),
    scope,
    recordId:requiredString(String(recordId),'recordId'),
    dimensions
  };
  return crypto.createHash('sha256').update(canonicalJson(material)).digest('hex');
}

export function assessBatchRun({
  provider,
  connector,
  runId,
  scope={},
  sourceWatermark=null,
  previousCheckpoint=null,
  watermarkKind='opaque',
  requiredScopeDimensions=[],
  datasetCoverage=null,
  rowCount,
  expectedRowCount=null,
  complete=false,
  checksumVerified=false,
  schemaVerified=false,
  duplicateRowKeys=[],
  parseErrors=0,
  transferErrors=0,
  sourceDeclaresDelta=false
}){
  requiredString(provider,'provider');
  requiredString(connector,'connector');
  requiredString(runId,'runId');
  if(!Number.isInteger(rowCount)||rowCount<0) throw new Error('rowCount must be a non-negative integer');
  if(expectedRowCount!==null&&(!Number.isInteger(expectedRowCount)||expectedRowCount<0)) throw new Error('expectedRowCount must be null or a non-negative integer');
  if(!Number.isInteger(parseErrors)||parseErrors<0) throw new Error('parseErrors must be a non-negative integer');
  if(!Number.isInteger(transferErrors)||transferErrors<0) throw new Error('transferErrors must be a non-negative integer');
  if(!Array.isArray(duplicateRowKeys)) throw new Error('duplicateRowKeys must be an array');
  requiredBoolean(complete,'complete');
  requiredBoolean(checksumVerified,'checksumVerified');
  requiredBoolean(schemaVerified,'schemaVerified');
  requiredBoolean(sourceDeclaresDelta,'sourceDeclaresDelta');

  const sourceScope=buildSourceScope(scope,{requiredDimensions:requiredScopeDimensions});
  if(sourceScope.dimensions.providerId!==provider) throw new Error('batch provider does not match source scope providerId');
  if(previousCheckpoint!==null) assertCheckpointScope(previousCheckpoint,sourceScope);
  const previousWatermark=previousCheckpoint?.watermark??null;

  const watermarkComparison=compareWatermarks(sourceWatermark,previousWatermark,watermarkKind);
  const reasons=[];
  if(!complete) reasons.push('incomplete-batch');
  if(!checksumVerified) reasons.push('checksum-unverified');
  if(!schemaVerified) reasons.push('schema-unverified');
  if(parseErrors) reasons.push('parse-errors');
  if(transferErrors) reasons.push('transfer-errors');
  if(duplicateRowKeys.length) reasons.push('duplicate-row-keys');
  if(expectedRowCount!==null&&rowCount!==expectedRowCount) reasons.push('row-count-mismatch');
  if(watermarkComparison.regressed) reasons.push('watermark-regression');

  const safeToCommit=reasons.length===0;
  const safeToAdvanceWatermark=safeToCommit&&sourceWatermark!==null;
  const absenceDisposition=datasetCoverage===null?'do-not-delete':missingRecordDisposition(datasetCoverage);
  const tombstoneCandidateAuthority=safeToCommit&&complete&& !sourceDeclaresDelta&&absenceDisposition==='tombstone-candidate';

  return Object.freeze({
    provider,
    connector,
    runId,
    scope:structuredClone(sourceScope.dimensions),
    scopeNamespace:sourceScope.checkpointNamespace,
    safeToCommit,
    safeToAdvanceWatermark,
    deletionAuthority:false,
    tombstoneCandidateAuthority,
    quarantine:!safeToCommit,
    reasons:Object.freeze(reasons),
    reconciliationRequired:!safeToCommit||sourceDeclaresDelta||!complete,
    absenceDisposition:tombstoneCandidateAuthority?'tombstone-candidate':'do-not-delete',
    watermark:Object.freeze({kind:watermarkKind,...watermarkComparison}),
    checkpointPrecondition:Object.freeze({
      scopeNamespace:sourceScope.checkpointNamespace,
      expectedPreviousWatermark:previousWatermark
    })
  });
}
