import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../../ux-overlay/ux-reset-cycle12-model.js', import.meta.url),'utf8');
const ctx={globalThis:{}};vm.createContext(ctx);vm.runInContext(src,ctx);
const M=ctx.globalThis.WFMUXCycle12Model;
if(!M)throw new Error('model missing');
const registry=new Map();
registry.set('implementation',()=>[{id:'ready-1',reasonCode:'IMPLEMENTATION_BLOCKER',evidenceState:'current',title:'Payroll contract missing',whyNow:'Go-live evidence is incomplete.'}]);
registry.set('handover',()=>[{id:'shift-22',reasonCode:'HANDOVER_CRITICAL',evidenceState:'current',title:'Line 4 handover',whyNow:'Incoming shift has an unresolved quality hold.'}]);
const rows=M.collect(registry);
if(rows.length!==2)throw new Error('expected 2 signals');
if(rows[0].source!=='implementation'||rows[0].route!=='onboarding')throw new Error('provider binding failed');
if(rows[1].source!=='handover'||rows[1].route!=='handover')throw new Error('handover binding failed');
if(M.normalise('not-approved',{id:'x'}))throw new Error('unknown provider accepted');
if(M.normalise('energy',{}))throw new Error('missing id accepted');
const spoofed=M.normalise('payroll',{id:'pay-1',route:'leave',reasonCode:'PAYROLL_VALIDATION',evidenceState:'current'});
if(!spoofed||spoofed.source!=='payroll'||spoofed.route!=='payroll-run')throw new Error('provider route escaped registered source workflow');
const validExplicit=M.normalise('attendance',{id:'att-1',route:'attendance',reasonCode:'ATTENDANCE_GAP',evidenceState:'current'});
if(!validExplicit||validExplicit.route!=='attendance')throw new Error('registered provider route rejected');

const impl=M.implementationSignals({runId:'run-1',state:'AT_RISK',completedRequirements:12,totalRequirements:17,remainingMinutes:30,criticalPathRemainingMinutes:75,deadlineAt:'2026-09-18T17:00:00Z',requirements:[{key:'payroll-mapping',status:'MISSING',satisfied:false}],blockingDecisions:[{key:'overtime-rule',question:'Confirm overtime rule?',risk:'HIGH',status:'PENDING'}]});
if(impl.length!==3)throw new Error('implementation mapper did not emit decision, gap and target risk');
if(!impl.every(x=>x.route==='onboarding'))throw new Error('implementation signals escaped owning workflow');
if(impl.find(x=>x.id==='readiness-gap').evidenceState!=='missing')throw new Error('missing implementation evidence was not kept non-current');

const integration=M.integrationSignals({connections:[
  {id:'auth-1',name:'Workday',productKey:'workday',category:'hcm',state:'AUTHORIZATION_REQUIRED'},
  {id:'reauth-1',name:'UKG',productKey:'ukg',category:'payroll-hcm',state:'REAUTH_REQUIRED'},
  {id:'degraded-1',name:'NetSuite',productKey:'netsuite',category:'erp',state:'DEGRADED',lastHealthAt:'2026-09-18T22:00:00Z'},
  {id:'active-1',name:'SAP S/4HANA',state:'ACTIVE'},
  {id:'validating-1',name:'ADP',state:'VALIDATING'}
]});
if(integration.length!==3)throw new Error('integration mapper should surface only actionable source states');
if(!integration.every(x=>x.route==='integrations'))throw new Error('integration signals escaped owning workflow');
const auth=integration.find(x=>x.id==='authorize:auth-1');
if(!auth||auth.reasonCode!=='NEEDS_REVIEW'||auth.evidenceState!=='current'||!auth.mandatory)throw new Error('authorization-required signal contract changed');
const reauth=integration.find(x=>x.id==='reauthorize:reauth-1');
if(!reauth||reauth.reasonCode!=='INTEGRATION_DEGRADED'||reauth.evidenceState!=='current'||!reauth.mandatory)throw new Error('reauthorization signal contract changed');
const degraded=integration.find(x=>x.id==='degraded:degraded-1');
if(!degraded||degraded.reasonCode!=='INTEGRATION_DEGRADED'||degraded.evidenceState==='current'||degraded.mandatory)throw new Error('degraded integration manufactured current evidence');

const c11=fs.readFileSync(new URL('../../ux-overlay/ux-reset-cycle11.js', import.meta.url),'utf8');
const c12=fs.readFileSync(new URL('../../ux-overlay/ux-reset-cycle12.js', import.meta.url),'utf8');
if(!c12.includes("'/api/integrations/autonomous/status'")||!c12.includes("mapper:'integrationSignals'"))throw new Error('authoritative integration status adapter is not bound');
if(!c12.includes("const refreshImplementation=force=>refreshSource('implementation',force)")||!c12.includes("const refreshIntegrations=force=>refreshSource('integrations',force)"))throw new Error('implementation and integrations do not reuse the shared source poller');
if(!c12.includes("registry.set('integrations',()=>sourceState.get('integrations')?.cache||[])"))throw new Error('integration provider is not registered on the unified signal surface');
if(!c11.includes('renderCard:card')||!c11.includes('restoreFocus')||!c11.includes('returnMarker'))throw new Error('Cycle 11 shared card/return primitives are not exported');
if(c12.includes('function card(')||c12.includes('ux12-open'))throw new Error('Cycle 12 reintroduced a duplicate decision-card renderer or navigation action');
if(!c12.includes('items.map(shared.renderCard)')||!c12.includes('shared.restoreFocus?.(section)'))throw new Error('specialist queue is not using the shared Cycle 11 card and return-focus primitive');
if(c11.includes("if(!manager()||page()==='overview')return"))throw new Error('return-to-context is still restricted to manager roles');
if(!c11.includes("else if(page()!=='overview'&&!document.querySelector('.ux11-back')&&returnMarker())addBackLink()"))throw new Error('specialist return-to-context observer is not active');
console.log('UX12_SIGNAL_CONTRACT=PASS');
console.log('UX12_PROVIDER_ROUTE_BINDING=PASS');
console.log('UX12_INTEGRATION_SOURCE_BINDING=PASS');
console.log('UX12_SHARED_DECISION_CARD=PASS');
console.log('UX12_SPECIALIST_RETURN_CONTEXT=PASS');