import crypto from 'node:crypto';

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
  previousWatermark=null,
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

  const reasons=[];
  if(!checksumVerified) reasons.push('checksum-unverified');
  if(!schemaVerified) reasons.push('schema-unverified');
  if(parseErrors) reasons.push('parse-errors');
  if(transferErrors) reasons.push('transfer-errors');
  if(duplicateRowKeys.length) reasons.push('duplicate-row-keys');
  if(expectedRowCount!==null&&rowCount!==expectedRowCount) reasons.push('row-count-mismatch');
  if(previousWatermark!==null&&sourceWatermark!==null&&String(sourceWatermark)<String(previousWatermark)) reasons.push('watermark-regression');

  const safeToCommit=reasons.length===0;
  const safeToAdvanceWatermark=safeToCommit&&sourceWatermark!==null;
  const deletionAuthority=safeToCommit&&complete&&!sourceDeclaresDelta;

  return Object.freeze({
    provider,
    connector,
    runId,
    scope:structuredClone(scope),
    safeToCommit,
    safeToAdvanceWatermark,
    deletionAuthority,
    quarantine:!safeToCommit,
    reasons:Object.freeze(reasons),
    reconciliationRequired:!safeToCommit||sourceDeclaresDelta||!complete
  });
}
