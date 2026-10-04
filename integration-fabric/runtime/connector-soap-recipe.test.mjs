import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {defineSoapReadRecipe,compileSoapReadRecipe} from './connector-soap-recipe.mjs';
import {executeProviderRead} from './provider-read-executor.mjs';
import {extractXmlRecords} from './safe-xml-records.mjs';
import {defineCanonicalMappingSpec,mapCanonicalRecord} from './connector-mapping-spec.mjs';

const NOW=Date.parse('2026-10-04T16:40:00.000Z');

function workday(){
  const contract=compileUniversalConnectorContract(connectorById('workday'),{
    tenantId:'northstar-demo',connectionId:'workday-sandbox'
  });
  const credentialRef='secret://tenant/northstar/workday';
  const connectionPlan=buildSafeConnectionTest({
    providerKey:'workday',sourceInstanceId:'workday-demo-source',
    wfmTenantId:'northstar-demo',connectionId:'workday-sandbox',
    endpointHost:'wd2-impl-services1.workday.com',environment:'sandbox',
    adapter:'soap-wsdl',authMethod:'oauth2',credentialRef,
    capabilities:['metadata','read'],requestedSemanticScopes:['vector.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:'workday',sourceInstanceId:'workday-demo-source',
    wfmTenantId:'northstar-demo',connectionId:'workday-sandbox',
    endpointHost:'wd2-impl-services1.workday.com',environment:'sandbox',
    readOnly:true,rawCredentialObserved:false,employeeOrPayrollDataObserved:false,
    latencyMs:18,observedAt:'2026-10-04T16:39:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {contract,connectionPlan,connectionEvidence,credentialRef};
}
function recipe(){
  return defineSoapReadRecipe({
    schemaVersion:1,id:'workday-workers-soap-v1',providerId:'workday',target:'worker',
    mappingProfile:'workday-worker-soap-v1',authMode:'oauth2-bearer',
    soapAction:'urn:com.workday/bsvc/Human_Resources/Get_Workers',
    pathSegments:['ccx','service',{param:{name:'tenantAlias',kind:'id'}},'Human_Resources','v44.1'],
    envelopeParts:[
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">',
      '<soapenv:Header/><soapenv:Body><wd:Get_Workers_Request wd:version="v44.1">',
      '<wd:Request_Criteria><wd:Worker_Reference><wd:ID wd:type="Employee_ID">',
      {param:{name:'employeeId',kind:'id'}},
      '</wd:ID></wd:Worker_Reference></wd:Request_Criteria>',
      '</wd:Get_Workers_Request></soapenv:Body></soapenv:Envelope>'
    ]
  });
}
const responseXml=`<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">
 <soapenv:Body>
  <wd:Get_Workers_Response>
   <wd:Response_Data>
    <wd:Worker>
      <wd:Worker_ID>EMP-42</wd:Worker_ID>
      <wd:First_Name>Ada</wd:First_Name>
      <wd:Last_Name>Lovelace</wd:Last_Name>
      <wd:Email>ada@example.test</wd:Email>
      <wd:Active>true</wd:Active>
    </wd:Worker>
   </wd:Response_Data>
  </wd:Get_Workers_Response>
 </soapenv:Body>
</soapenv:Envelope>`;

test('SOAP recipe stays on exact verified host and XML-escapes dynamic envelope values',()=>{
  const ctx=workday();
  const plan=compileSoapReadRecipe({
    recipe:recipe(),...ctx,
    parameters:{tenantAlias:'acme_demo',employeeId:'EMP-42'},
    nowMs:NOW
  });
  const url=new URL(plan.request.url);
  assert.equal(url.host,'wd2-impl-services1.workday.com');
  assert.equal(url.pathname,'/ccx/service/acme_demo/Human_Resources/v44.1');
  assert.equal(plan.request.method,'POST');
  assert.equal(plan.request.responseFormat,'xml');
  assert.equal(plan.request.readViaPostProven,true);
  assert.equal(plan.request.headers.soapaction,'urn:com.workday/bsvc/Human_Resources/Get_Workers');
  assert.match(plan.request.body,/EMP-42/);
  assert.equal(plan.writeAuthority,false);

  const escaped=compileSoapReadRecipe({
    recipe:defineSoapReadRecipe({
      schemaVersion:1,id:'escape',providerId:'workday',target:'worker',
      mappingProfile:'x',authMode:'oauth2',soapAction:'urn:test',
      pathSegments:['ccx','service',{param:{name:'tenantAlias',kind:'id'}},'Human_Resources','v44.1'],
      envelopeParts:['<root><value>',{param:{name:'value',kind:'text'}},'</value></root>']
    }),
    ...ctx,parameters:{tenantAlias:'acme_demo',value:'A&B <C>'},nowMs:NOW
  });
  assert.equal(escaped.request.body,'<root><value>A&amp;B &lt;C&gt;</value></root>');
});

test('bounded SOAP response extracts records then maps through existing declarative VECTOR mapper',async()=>{
  const ctx=workday();
  const plan=compileSoapReadRecipe({
    recipe:recipe(),...ctx,parameters:{tenantAlias:'acme_demo',employeeId:'EMP-42'},nowMs:NOW
  });
  const execution=await executeProviderRead({
    plan,contract:ctx.contract,
    credentialAuthorizer:async()=>({authorization:'Bearer fixture'}),
    fetchImpl:async()=>new Response(responseXml,{status:200,headers:{'content-type':'text/xml; charset=utf-8'}}),
    clock:()=>NOW
  });
  assert.equal(execution.receipt.responseFormat,'xml');
  const rows=extractXmlRecords({
    xml:execution.data,
    recordPath:['Envelope','Body','Get_Workers_Response','Response_Data','Worker'],
    fields:{
      id:['Worker_ID'],
      first:['First_Name'],
      last:['Last_Name'],
      email:{path:['Email'],optional:true},
      active:['Active']
    }
  });
  assert.equal(rows.length,1);

  const mapping=defineCanonicalMappingSpec({
    schemaVersion:1,id:'workday-worker-soap-map-v1',providerId:'workday',
    sourceObjectType:'Worker',canonicalType:'worker',
    fields:{
      externalId:{path:'id',kind:'id'},
      displayName:{concat:[{path:'first',kind:'string'},{path:'last',kind:'string'}],separator:' '},
      active:{map:{path:'active',cases:[
        {values:['true'],output:true},{values:['false'],output:false}
      ]}}
    },
    attributes:{email:{path:'email',kind:'string',optional:true}}
  });
  const worker=mapCanonicalRecord({spec:mapping,providerId:'workday',sourceRecord:rows[0],receipt:execution.receipt});
  assert.equal(worker.externalId,'EMP-42');
  assert.equal(worker.displayName,'Ada Lovelace');
  assert.equal(worker.active,true);
  assert.equal(worker.attributes.email,'ada@example.test');
});

test('SOAP recipe cannot choose a different host or inject raw auth headers',()=>{
  const ctx=workday();
  const plan=compileSoapReadRecipe({
    recipe:recipe(),...ctx,
    parameters:{tenantAlias:'acme_demo',employeeId:'EMP-42',endpointHost:'attacker.example'},
    nowMs:NOW
  });
  assert.equal(new URL(plan.request.url).host,'wd2-impl-services1.workday.com');

  assert.throws(()=>defineSoapReadRecipe({
    schemaVersion:1,id:'bad',providerId:'workday',target:'worker',mappingProfile:'x',
    authMode:'oauth2',soapAction:'urn:test',pathSegments:['soap'],
    envelopeParts:['<!DOCTYPE x><root/>']
  }),/forbidden markup/);
});

test('SOAP path and body parameters fail closed before provider request creation',()=>{
  const ctx=workday();
  assert.throws(()=>compileSoapReadRecipe({
    recipe:recipe(),...ctx,
    parameters:{tenantAlias:'../../other',employeeId:'EMP-42'},nowMs:NOW
  }),error=>error.code==='WFM_SOAP_PARAMETER_INVALID');

  assert.throws(()=>compileSoapReadRecipe({
    recipe:recipe(),...ctx,
    parameters:{tenantAlias:'acme_demo',employeeId:'bad/id'},nowMs:NOW
  }),error=>error.code==='WFM_SOAP_PARAMETER_INVALID');
});

test('SOAP recipe only compiles for connectors that actually declare SOAP and the target',()=>{
  const work=workday();
  const wrong=compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',connectionId:'netsuite-sandbox'
  });
  assert.throws(()=>compileSoapReadRecipe({
    recipe:recipe(),contract:wrong,connectionPlan:work.connectionPlan,
    connectionEvidence:work.connectionEvidence,credentialRef:work.credentialRef,
    parameters:{tenantAlias:'acme_demo',employeeId:'EMP-42'},nowMs:NOW
  }),error=>error.code==='WFM_SOAP_BINDING_MISMATCH');
});
