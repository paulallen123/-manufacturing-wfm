import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {defineCanonicalMappingSpec} from './connector-mapping-spec.mjs';
import {defineFileBatchRecipe,acquireFileBatch} from './connector-file-batch.mjs';
import {buildCanonicalStagingCommand} from './provider-ingestion-gate.mjs';

const NOW=Date.parse('2026-10-04T16:50:00.000Z');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function setup(){
  const contract=compileUniversalConnectorContract(connectorById('paycom'),{
    tenantId:'northstar-demo',connectionId:'paycom-sftp-sandbox'
  });
  const credentialRef='secret://tenant/northstar/paycom-sftp';
  const connectionPlan=buildSafeConnectionTest({
    providerKey:'paycom',sourceInstanceId:'paycom-file-export-sandbox',
    wfmTenantId:'northstar-demo',connectionId:'paycom-sftp-sandbox',
    endpointHost:'sftp.paycom.example',environment:'sandbox',
    adapter:'file-batch',authMethod:'ssh-key',credentialRef,
    capabilities:['files','read'],requestedSemanticScopes:['worker.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:'paycom',sourceInstanceId:'paycom-file-export-sandbox',
    wfmTenantId:'northstar-demo',connectionId:'paycom-sftp-sandbox',
    endpointHost:'sftp.paycom.example',environment:'sandbox',
    readOnly:true,rawCredentialObserved:false,employeeOrPayrollDataObserved:false,
    latencyMs:30,observedAt:'2026-10-04T16:49:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  const mappingSpec=defineCanonicalMappingSpec({
    schemaVersion:1,id:'paycom-worker-file-v1',providerId:'paycom',
    sourceObjectType:'employee-export',canonicalType:'worker',
    fields:{
      externalId:{path:'employee_id',kind:'id'},
      employeeNumber:{path:'payroll_code',kind:'string'},
      displayName:{concat:[{path:'first_name',kind:'string'},{path:'last_name',kind:'string'}],separator:' '},
      active:{map:{path:'active',cases:[
        {values:['Y','true','1'],output:true},
        {values:['N','false','0'],output:false}
      ]}}
    },
    attributes:{departmentName:{path:'department',kind:'string',optional:true}}
  });
  const recipe=defineFileBatchRecipe({
    schemaVersion:1,id:'paycom-worker-csv-v1',providerId:'paycom',target:'worker',dataset:'workers',
    mappingProfile:'paycom-worker-file-v1',format:'csv',datasetMode:'snapshot',
    fileName:{prefix:'VECTOR_EMPLOYEES_',suffix:'.csv'},
    maxBytes:1024*1024,maxRecords:10000,
    csv:{delimiter:',',headers:['employee_id','payroll_code','first_name','last_name','active','department']}
  });
  return {contract,connectionPlan,connectionEvidence,credentialRef,mappingSpec,recipe};
}
function receipt(ctx,fileName,bytes,overrides={}){
  return {
    providerId:'paycom',tenantId:'northstar-demo',connectionId:'paycom-sftp-sandbox',
    configurationFingerprint:ctx.connectionPlan.configurationFingerprint,
    fileName,sizeBytes:bytes.byteLength,fileSha256:hash(bytes),expectedRowCount:2,
    readOnly:true,complete:true,rawCredentialObserved:false,
    observedAt:'2026-10-04T16:49:45.000Z',
    ...overrides
  };
}

test('verified SFTP/file CSV batch maps into VECTOR Worker acquisition and staging contract',()=>{
  const ctx=setup();
  const bytes=Buffer.from(
    'employee_id,payroll_code,first_name,last_name,active,department\n'+
    'EMP-1,PAY-1,Ada,Lovelace,Y,Line 1\n'+
    'EMP-2,PAY-2,"Grace, A.",Hopper,Y,Line 2\n','utf8'
  );
  const acquisition=acquireFileBatch({
    ...ctx,transportReceipt:receipt(ctx,'VECTOR_EMPLOYEES_20261004.csv',bytes),
    bytes,runId:'paycom-file-run-1',nowMs:NOW
  });
  assert.equal(acquisition.status,'SAFE_TO_STAGE');
  assert.equal(acquisition.records.length,2);
  assert.equal(acquisition.records[0].externalId,'EMP-1');
  assert.equal(acquisition.records[0].displayName,'Ada Lovelace');
  assert.equal(acquisition.records[1].displayName,'Grace, A. Hopper');
  assert.equal(acquisition.records[1].attributes.departmentName,'Line 2');
  assert.equal(acquisition.reconciliation.safeToCommit,true);
  assert.ok(acquisition.checkpointCandidate);
  const staging=buildCanonicalStagingCommand(acquisition,ctx.contract);
  assert.equal(staging.route,'/workers');
  assert.equal(staging.rowCount,2);
  assert.equal(staging.deletionAuthority,false);
});

test('checksum size filename and binding mismatches fail before parsing',()=>{
  const ctx=setup();
  const bytes=Buffer.from('employee_id,payroll_code,first_name,last_name,active,department\nEMP-1,PAY-1,Ada,Lovelace,Y,Line 1\n','utf8');
  for(const [override,matcher] of [
    [{fileSha256:'0'.repeat(64)},'WFM_FILE_BATCH_CHECKSUM_MISMATCH'],
    [{sizeBytes:bytes.length+1},'WFM_FILE_BATCH_CHECKSUM_MISMATCH'],
    [{fileName:'../../escape.csv'},'WFM_FILE_BATCH_INVALID'],
    [{tenantId:'other-tenant'},'WFM_FILE_BATCH_BINDING_MISMATCH']
  ]){
    assert.throws(()=>acquireFileBatch({
      ...ctx,transportReceipt:receipt(ctx,'VECTOR_EMPLOYEES_20261004.csv',bytes,{expectedRowCount:1,...override}),
      bytes,runId:'bad',nowMs:NOW
    }),error=>error.code===matcher);
  }
});

test('CSV header drift and wrong row width fail closed',()=>{
  const ctx=setup();
  const wrongHeader=Buffer.from('employee_id,first_name,last_name\nEMP-1,Ada,Lovelace\n','utf8');
  assert.throws(()=>acquireFileBatch({
    ...ctx,transportReceipt:receipt(ctx,'VECTOR_EMPLOYEES_20261004.csv',wrongHeader,{expectedRowCount:1}),
    bytes:wrongHeader,runId:'header-drift',nowMs:NOW
  }),error=>error.code==='WFM_FILE_BATCH_SCHEMA_MISMATCH');

  const wrongWidth=Buffer.from(
    'employee_id,payroll_code,first_name,last_name,active,department\nEMP-1,PAY-1,Ada,Lovelace,Y\n','utf8'
  );
  assert.throws(()=>acquireFileBatch({
    ...ctx,transportReceipt:receipt(ctx,'VECTOR_EMPLOYEES_20261004.csv',wrongWidth,{expectedRowCount:1}),
    bytes:wrongWidth,runId:'width-drift',nowMs:NOW
  }),error=>error.code==='WFM_FILE_BATCH_SCHEMA_MISMATCH');
});

test('duplicate mapped worker identity quarantines file batch and withholds checkpoint',()=>{
  const ctx=setup();
  const bytes=Buffer.from(
    'employee_id,payroll_code,first_name,last_name,active,department\n'+
    'EMP-1,PAY-1,Ada,Lovelace,Y,Line 1\n'+
    'EMP-1,PAY-2,Grace,Hopper,Y,Line 2\n','utf8'
  );
  const acquisition=acquireFileBatch({
    ...ctx,transportReceipt:receipt(ctx,'VECTOR_EMPLOYEES_20261004.csv',bytes),
    bytes,runId:'duplicate',nowMs:NOW
  });
  assert.equal(acquisition.status,'QUARANTINED');
  assert.ok(acquisition.reconciliation.reasons.includes('duplicate-row-keys'));
  assert.equal(acquisition.checkpointCandidate,null);
});

test('JSON-array file batches use same binding and mapping path',()=>{
  const ctx=setup();
  const recipe=defineFileBatchRecipe({
    schemaVersion:1,id:'paycom-worker-json-v1',providerId:'paycom',target:'worker',dataset:'workers',
    mappingProfile:'paycom-worker-file-v1',format:'json-array',datasetMode:'delta',
    fileName:{prefix:'VECTOR_EMPLOYEES_',suffix:'.json'},maxBytes:1024*1024,maxRecords:10000
  });
  const bytes=Buffer.from(JSON.stringify([
    {employee_id:'EMP-1',payroll_code:'PAY-1',first_name:'Ada',last_name:'Lovelace',active:'Y',department:'Line 1'},
    {employee_id:'EMP-2',payroll_code:'PAY-2',first_name:'Grace',last_name:'Hopper',active:'N',department:'Line 2'}
  ]),'utf8');
  const acquisition=acquireFileBatch({
    ...ctx,recipe,transportReceipt:receipt(ctx,'VECTOR_EMPLOYEES_20261004.json',bytes),
    bytes,runId:'json-delta',nowMs:NOW
  });
  assert.equal(acquisition.status,'SAFE_TO_STAGE');
  assert.equal(acquisition.records[1].active,false);
  assert.equal(acquisition.reconciliation.reconciliationRequired,true);
  assert.equal(acquisition.deletionAuthority,false);
});

test('file byte and record bounds fail closed',()=>{
  const ctx=setup();
  const tinyRecipe=defineFileBatchRecipe({
    schemaVersion:1,id:'tiny',providerId:'paycom',target:'worker',dataset:'workers',
    mappingProfile:'paycom-worker-file-v1',format:'csv',datasetMode:'snapshot',
    fileName:{prefix:'VECTOR_EMPLOYEES_',suffix:'.csv'},maxBytes:32,maxRecords:1,
    csv:{delimiter:',',headers:['employee_id','payroll_code','first_name','last_name','active','department']}
  });
  const bytes=Buffer.from(
    'employee_id,payroll_code,first_name,last_name,active,department\nEMP-1,PAY-1,Ada,Lovelace,Y,Line 1\n','utf8'
  );
  assert.throws(()=>acquireFileBatch({
    ...ctx,recipe:tinyRecipe,transportReceipt:receipt(ctx,'VECTOR_EMPLOYEES_20261004.csv',bytes,{expectedRowCount:1}),
    bytes,runId:'too-big',nowMs:NOW
  }),error=>error.code==='WFM_FILE_BATCH_LIMIT');
});
