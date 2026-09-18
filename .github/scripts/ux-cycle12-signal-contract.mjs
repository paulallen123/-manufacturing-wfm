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

const impl=M.implementationSignals({runId:'run-1',state:'AT_RISK',completedRequirements:12,totalRequirements:17,remainingMinutes:30,criticalPathRemainingMinutes:75,deadlineAt:'2026-09-18T17:00:00Z',requirements:[{key:'payroll-mapping',status:'MISSING',satisfied:false}],blockingDecisions:[{key:'overtime-rule',question:'Confirm overtime rule?',risk:'HIGH',status:'PENDING'}]});
if(impl.length!==3)throw new Error('implementation mapper did not emit decision, gap and target risk');
if(!impl.every(x=>x.route==='onboarding'))throw new Error('implementation signals escaped owning workflow');
if(impl.find(x=>x.id==='readiness-gap').evidenceState!=='missing')throw new Error('missing implementation evidence was not kept non-current');

const c11=fs.readFileSync(new URL('../../ux-overlay/ux-reset-cycle11.js', import.meta.url),'utf8');
const c12=fs.readFileSync(new URL('../../ux-overlay/ux-reset-cycle12.js', import.meta.url),'utf8');
if(!c11.includes('restoreFocus,addBackLink,returnMarker'))throw new Error('shared return-context primitive not exported');
if(c11.includes("if(!manager()||page()==='overview')return;"))throw new Error('return link remains manager-only');
if(!c11.includes("else if(page()!=='overview'&&!document.querySelector('.ux11-back')&&returnMarker())addBackLink()"))throw new Error('specialist source workflow return link is not observed');
if(!c12.includes('WFMUXCycle11?.restoreFocus?.(section)'))throw new Error('specialist queue does not reuse shared return-focus primitive');
console.log('UX12_SIGNAL_CONTRACT=PASS');
console.log('UX12_SPECIALIST_RETURN_CONTEXT=PASS');
