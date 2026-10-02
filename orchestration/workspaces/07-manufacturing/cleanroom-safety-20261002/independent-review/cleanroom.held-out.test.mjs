import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assessControlledEnvironmentPlan as assess,projectControlledEnvironmentMovement as project} from '../lane07-cleanroom/source/operations/runtime/controlled-environment-safety.mjs';
const observations=[];
const now='2026-09-20T12:00:00.000Z';
const src=(extra={})=>({tenantId:'t1',siteId:'s1',authoritative:true,ref:'source',revision:'r1',observedAt:now,...extra});
const context=()=>({tenant:'t1',siteId:'s1',contextRevision:'c1',now,policy:{...src({ref:'policy'}),version:'p1',maxAgeMinutes:60,defaultOutsideZone:'OUT',zones:{B:{maxPersonnel:2}},transitions:[{from:'OUT',to:'B',allowed:true,gowningCycle:true,controlMinutes:3,controlCost:5},{from:'B',to:'OUT',allowed:true,gowningCycle:false,controlMinutes:2,controlCost:7}]}});
const plan=()=>({...context(),workers:[{...src({ref:'worker'}),id:'w1',skills:['inspect'],qualifiedZones:['B'],currentZone:'OUT'}],tasks:[{...src({ref:'task'}),id:'task1',slot:1,zone:'B',skill:'inspect',requiredHeadcount:1}],plan:{id:'plan1',assignments:[{workerId:'w1',taskId:'task1'}]}});
const movement=()=>({...context(),tasks:[{...src({ref:'task'}),id:'task1',workerId:'w1',zone:'B',policyVersion:'p1',startAt:'2026-09-20T11:20:00.000Z',endAt:'2026-09-20T11:40:00.000Z'}],presenceEvents:[{...src({ref:'enter',observedAt:'2026-09-20T11:15:00.000Z'}),id:'ev1',workerId:'w1',zone:'B',policyVersion:'p1',direction:'enter'},{...src({ref:'exit',observedAt:'2026-09-20T11:45:00.000Z'}),id:'ev2',workerId:'w1',zone:'B',policyVersion:'p1',direction:'exit'}]});
const save=(name,result,extra={})=>observations.push({name,result,...extra});
test.after(()=>fs.writeFileSync(fileURLToPath(new URL('./cleanroom.observations.json',import.meta.url)),JSON.stringify({sourceBlob:'2478100335800c6d65cb98ff03735de646bf2d35',observations},null,2)));
test('positive inert plan and observed movement retain explicit no execution/completion authority',()=>{
 for(const [fn,input,status]of [[assess,plan(),'safe_candidate'],[project,movement(),'movement_ready']]){const before=JSON.stringify(input),r=fn(input);assert.equal(r.status,status);assert.equal(r.executionPermitted,false);assert.ok(Object.isFrozen(r));assert.equal(JSON.stringify(input),before);assert.match(r.evidenceDigest,/^[a-f0-9]{64}$/);if(fn===project)assert.equal(r.taskCompletionProven,false);}
});
const unsafe=[
 ['top-level getter',(x,inc)=>Object.defineProperty(x,'tenant',{enumerable:true,get(){inc();return't1';}})],
 ['nested getter',(x,inc)=>Object.defineProperty(x.policy,'version',{enumerable:true,get(){inc();return'p1';}})],
 ['indexed getter',(x,inc)=>Object.defineProperty(x.policy.transitions,'0',{enumerable:true,get(){inc();return{};}})],
 ['toJSON',(x,inc)=>{x.policy.toJSON=()=>{inc();return{};};}],
 ['array map override',(x,inc)=>{x.policy.transitions.map=()=>{inc();return[];};}],
 ['array iterator override',(x,inc)=>{x.policy.transitions[Symbol.iterator]=()=>{inc();return[][Symbol.iterator]();};}],
 ['prototype record',(x,inc)=>{const descriptors=Object.getOwnPropertyDescriptors(x.policy);delete descriptors.version;x.policy=Object.create({get version(){inc();return'p1';}},descriptors);}],
 ['proxy record',(x,inc)=>{x.policy=new Proxy(x.policy,{get(t,k){inc();return t[k];},ownKeys(t){inc();return Reflect.ownKeys(t);},getPrototypeOf(t){inc();return Object.getPrototypeOf(t);}});}],
 ['proxy array',(x,inc)=>{x.policy.transitions=new Proxy(x.policy.transitions,{get(t,k){inc();return t[k];},ownKeys(t){inc();return Reflect.ownKeys(t);},getPrototypeOf(t){inc();return Object.getPrototypeOf(t);}});}],
 ['revoked proxy',(x)=>{const p=Proxy.revocable({},{});p.revoke();x.unrelated=p.proxy;}],
 ['sparse array',(x)=>{delete x.policy.transitions[0];}],
 ['array symbol',(x)=>{x.policy.transitions[Symbol('metadata')]=0;}],
 ['cycle',(x)=>{x.unrelated=x;}],
 ['deep input',(x)=>{let p=x;for(let i=0;i<18;i++)p=p.nested={};}],
 ...[NaN,Infinity,-Infinity].map((v,i)=>['nonfinite'+i,(x)=>{x.unrelated={numeric:v};}])
];
for(const[name,mutate]of unsafe)test('both consumers reject '+name+' without caller execution',()=>{
 let calls=0;for(const [label,fn,fixture]of [['plan',assess,plan],['movement',project,movement]]){const input=fixture();mutate(input,()=>calls++);const r=fn(input);save(name+':'+label,r,{userCodeCalls:calls});assert.equal(r.status,'blocked');assert.equal(r.executionPermitted,false);}assert.equal(calls,0);
});
test('scope, source authority, provenance and exact-current evidence reject before ready',()=>{
 for(const mutate of [x=>x.policy.tenantId='t2',x=>x.policy.siteId='s2',x=>x.policy.authoritative=false,x=>delete x.policy.ref,x=>delete x.policy.revision,x=>x.policy.observedAt='2026-09-20T12:00:00.001Z',x=>x.policy.observedAt='2026-09-20T10:59:59.999Z',x=>x.policy.observedAt='2026-02-30T12:00:00.000Z'])for(const[fn,fixture]of[[assess,plan],[project,movement]]){const x=fixture();mutate(x);assert.equal(fn(x).status,'blocked');}
});
test('distinct separator-bearing worker and zone IDs preserve coverage and occupancy',()=>{
 const x=plan();x.workers[0].id='a|b';x.plan.assignments[0].workerId='a|b';x.policy.zones['b|c']={maxPersonnel:1};x.tasks[0].zone='b|c';x.workers[0].qualifiedZones=['b|c'];x.policy.transitions[0].to='b|c';assert.equal(assess(x).status,'safe_candidate');
 const y=plan();y.workers.push({...y.workers[0],id:'w|2'});y.tasks[0].requiredHeadcount=2;y.plan.assignments.push({workerId:'w|2',taskId:'task1'});y.policy.zones.B.maxPersonnel=1;assert.equal(assess(y).status,'blocked');
});
test('duplicate worker/task/event exact IDs and assignment double-booking cannot manufacture coverage',()=>{
 for(const mutate of [x=>x.workers.push({...x.workers[0]}),x=>x.tasks.push({...x.tasks[0]}),x=>x.plan.assignments.push({...x.plan.assignments[0]})]){const x=plan();mutate(x);assert.equal(assess(x).status,'blocked');}
 const x=movement();x.presenceEvents[1].id=x.presenceEvents[0].id;assert.equal(project(x).status,'blocked');
});
test('task ordering follows actual slots and cannot use caller array order to hide forbidden transition',()=>{
 const x=plan();x.policy.zones.C={maxPersonnel:2};x.workers[0].qualifiedZones.push('C');x.tasks.push({...x.tasks[0],id:'task2',slot:2,zone:'C'});x.plan.assignments.unshift({workerId:'w1',taskId:'task2'});x.policy.transitions.push({from:'B',to:'C',allowed:false},{from:'OUT',to:'C',allowed:true});assert.equal(assess(x).status,'blocked');
});
test('finite plan metric accumulation overflow blocks',()=>{
 const x=plan();x.policy.zones.C={maxPersonnel:2};x.workers[0].qualifiedZones.push('C');x.tasks.push({...x.tasks[0],id:'task2',slot:2,zone:'C'});x.plan.assignments.push({workerId:'w1',taskId:'task2'});x.policy.transitions[0].controlCost=1e308;x.policy.transitions.push({from:'B',to:'C',allowed:true,controlCost:1e308});assert.equal(assess(x).status,'blocked');
});
test('positive task/session intersection is half-open; endpoint touch never proves overlap or completion',()=>{
 const x=movement();x.tasks[0].startAt=x.presenceEvents[1].observedAt;x.tasks[0].endAt='2026-09-20T11:50:00.000Z';const r=project(x);assert.equal(r.status,'movement_ready');assert.equal(r.sessions[0].attribution,'needs_review');assert.deepEqual(r.sessions[0].matchedTaskIds,[]);assert.equal(r.taskCompletionProven,false);
});
test('zero/negative task windows and event future times block',()=>{
 for(const mutate of [x=>x.tasks[0].endAt=x.tasks[0].startAt,x=>x.tasks[0].startAt=x.tasks[0].endAt,x=>x.presenceEvents[1].observedAt='2026-09-20T12:00:00.001Z']){const x=movement();mutate(x);assert.equal(project(x).status,'blocked');}
});
test('open, orphan, duplicate-enter and zero-duration sessions force review',()=>{
 for(const mutate of [x=>x.presenceEvents.pop(),x=>x.presenceEvents.shift(),x=>x.presenceEvents.push({...x.presenceEvents[0],id:'ev0'}),x=>x.presenceEvents[1].observedAt=x.presenceEvents[0].observedAt]){const x=movement();mutate(x);const r=project(x);assert.equal(r.status,'needs_review');assert.ok(r.dataQualityIssues.length);}
});
test('overlapping sessions across zones for one person remain data-quality conflicts',()=>{
 const x=movement();x.policy.zones.C={maxPersonnel:2};x.policy.transitions.push({from:'OUT',to:'C',allowed:true},{from:'C',to:'OUT',allowed:true});x.presenceEvents.push({...x.presenceEvents[0],id:'ev3',zone:'C',observedAt:'2026-09-20T11:20:00.000Z'},{...x.presenceEvents[1],id:'ev4',zone:'C',observedAt:'2026-09-20T11:35:00.000Z'});const r=project(x);assert.equal(r.status,'needs_review');assert.ok(r.dataQualityIssues.some(x=>x.code==='overlapping-presence-sessions'));
});
test('half-open occupancy boundary admits departure at same instant as another arrival',()=>{
 const x=movement();x.policy.zones.B.maxPersonnel=1;x.presenceEvents.push({...x.presenceEvents[0],id:'ev3',workerId:'w2',observedAt:'2026-09-20T11:45:00.000Z'},{...x.presenceEvents[1],id:'ev4',workerId:'w2',observedAt:'2026-09-20T11:55:00.000Z'});assert.equal(project(x).status,'movement_ready');x.presenceEvents[2].observedAt='2026-09-20T11:44:59.999Z';assert.equal(project(x).status,'needs_review');
});
test('missing/disallowed exit remains visible and needs review',()=>{
 for(const remove of [true,false]){const x=movement();if(remove)x.policy.transitions.pop();else x.policy.transitions[1].allowed=false;const r=project(x);assert.equal(r.status,'needs_review');assert.equal(r.unapprovedMovement[0].from,'B');assert.equal(r.unapprovedMovement[0].to,'OUT');assert.equal(r.executionPermitted,false);}
});
test('evidence digest binds context/policy/source revisions and minimized output stays immutable',()=>{
 const x=movement(),r=project(x);for(const mutate of [x=>x.contextRevision='c2',x=>x.policy.revision='r2',x=>x.presenceEvents[0].revision='r2']){const y=movement();mutate(y);assert.notEqual(project(y).evidenceDigest,r.evidenceDigest);}assert.throws(()=>r.sessions[0].workerId='bad',TypeError);x.secret='SHOULD_NOT_LEAK';assert.equal(project(x).evidenceDigest,r.evidenceDigest);assert.ok(!JSON.stringify(project(x)).includes('SHOULD_NOT_LEAK'));
});
test('inherited movement control metrics count entry controls and retain exit controls separately',()=>{
 const r=project(movement());save('entry-only-control-metrics',r);assert.equal(r.status,'movement_ready');assert.equal(r.movement.length,2);assert.equal(r.metrics.observedControlMinutes,3);assert.equal(r.metrics.observedControlCost,5);assert.equal(r.movement[1].controlMinutes,2);assert.equal(r.movement[1].controlCost,7);
});
test('unknown exit controls stay unknown in row and do not alter inherited entry-only metric',()=>{
 const x=movement();delete x.policy.transitions[1].controlCost;const r=project(x);save('unknown-exit-entry-only-metric',r);assert.equal(r.status,'movement_ready');assert.equal(r.movement[1].controlCost,null);assert.equal(r.metrics.observedControlCost,5);
});
test('unknown entry control economics remain unknown in entry-only metric',()=>{
 const x=movement();delete x.policy.transitions[0].controlCost;delete x.policy.transitions[0].controlMinutes;const r=project(x);assert.equal(r.status,'movement_ready');assert.equal(r.metrics.observedControlCost,null);assert.equal(r.metrics.observedControlMinutes,null);
});
test('multiple finite observed entry controls cannot overflow aggregate metrics',()=>{
 const x=movement();x.policy.transitions[0].controlCost=1e308;x.presenceEvents.push({...x.presenceEvents[0],id:'ev3',workerId:'w2'},{...x.presenceEvents[1],id:'ev4',workerId:'w2'});const r=project(x);assert.equal(r.status,'blocked');assert.equal(r.reason,'metric-budget-exceeded');
});
