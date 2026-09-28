import crypto from 'node:crypto';
import {buildSourceScope,assertCheckpointScope} from './scope-partition.mjs';
import {missingRecordDisposition,normalizeDatasetCoverage} from './dataset-coverage.mjs';

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
  if(!WATERMARK_KINDS.has(kind)) throw new Error(`unsupported watermarkKind: ${kind}`);

  const validate=value=>{
    if(value===null) return;
    if(kind==='iso8601'){
      if(typeof value!=='string') throw new Error('iso8601 watermarks must be timestamp strings');
      const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
      if(!match) throw new Error('iso8601 watermarks must be valid timestamps with an explicit offset and no more than millisecond precision');
      const [,yearText,monthText,dayText,hourText,minuteText,secondText,,,offsetSign,offsetHourText,offsetMinuteText]=match;
      const year=Number(yearText),month=Number(monthText),day=Number(dayText);
      const hour=Number(hourText),minute=Number(minuteText),second=Number(secondText);
      const leap=year%4===0&&(year%100!==0||year%400===0);
      const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
      const offsetHour=offsetSign?Number(offsetHourText):0;
      const offsetMinute=offsetSign?Number(offsetMinuteText):0;
      const validCalendar=month>=1&&month<=12&&day>=1&&day<=days[month-1];
      const validClock=hour<=23&&minute<=59&&second<=59;
      const validOffset=offsetHour<=14&&offsetMinute<=59&&(offsetHour<14||offsetMinute===0);
      if(!validCalendar||!validClock||!validOffset||!Number.isFinite(Date.parse(value))) throw new Error('iso8601 watermark contains an invalid calendar date, clock time or offset');
    }
    if(kind==='unsigned-integer'&&(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value))) throw new Error('unsigned-integer watermarks must be canonical decimal strings');
    if((kind==='opaque'||kind==='lexical')&&(typeof value!=='string'||!value.length)) throw new Error(`${kind} watermarks must be non-empty strings`);
  };
  validate(current);
  validate(previous);
  if(current===null||previous===null) return Object.freeze({comparable:false,regressed:false});

  if(kind==='opaque'){
    return Object.freeze({comparable:false,regressed:false});
  }

  if(kind==='iso8601'){
    const currentEpoch=Date.parse(String(current));
    const previousEpoch=Date.parse(String(previous));
    return Object.freeze({comparable:true,regressed:currentEpoch<previousEpoch});
  }

  if(kind==='unsigned-integer'){
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
  previousWatermark:legacyPreviousWatermark=undefined,
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
  if(legacyPreviousWatermark!==undefined) throw new Error('previousWatermark is unsupported; supply a scope-bound previousCheckpoint');

  const sourceScope=buildSourceScope(scope,{requiredDimensions:requiredScopeDimensions});
  if(sourceScope.dimensions.providerId!==provider) throw new Error('batch provider does not match source scope providerId');
  if(previousCheckpoint!==null){
    assertCheckpointScope(previousCheckpoint,sourceScope);
    if(!Object.hasOwn(previousCheckpoint,'watermark')) throw new Error('previous checkpoint is missing its watermark precondition');
    if(previousCheckpoint.watermarkKind!==watermarkKind) throw new Error('checkpoint watermark kind mismatch; start a new checkpoint namespace and reconcile');
  }
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
  const normalizedCoverage=datasetCoverage===null?null:normalizeDatasetCoverage(datasetCoverage);
  if(normalizedCoverage!==null){
    if(!sourceScope.dimensions.dataset) throw new Error('dataset coverage requires a dataset-bound source scope');
    if(normalizedCoverage.dataset!==sourceScope.dimensions.dataset) throw new Error('dataset coverage does not match source scope dataset');
    if(datasetCoverage.scopeNamespace!==sourceScope.checkpointNamespace) throw new Error('dataset coverage is not bound to the current source scope namespace');
  }
  const absenceDisposition=normalizedCoverage===null?'do-not-delete':missingRecordDisposition(normalizedCoverage);
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
      expectedPreviousWatermark:previousWatermark,
      expectedWatermarkKind:watermarkKind
    })
  });
}
