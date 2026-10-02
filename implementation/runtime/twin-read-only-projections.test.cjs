'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTwinRevision}=require('./implementation-digital-twin.cjs');
let projections;
try{projections=require('./twin-read-only-projections.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;projections={};}
function api(name){assert.equal(typeof projections[name],'function',`Missing read-only behavior: ${name}`);return projections[name];}
const at='2026-09-20T10:00:00.000Z';
function node(id,type,data={},observedAt=at){return {id,type,source:'canonical-fixture',observedAt,verified:true,data};}
function twin(nodes=[node('site','site'),node('evidence','evidence',{nested:{value:1}})],edges=[{from:'site',to:'evidence',relation:'proven-by',source:'fixture',observedAt:at,verified:true,effectiveAt:'2026-09-20T10:10:00.000Z',data:{validTo:'2026-09-20T10:20:00.000Z'}}]){return createTwinRevision({tenant:'alpha',nodes,edges});}

// Break caught: replacing canonical IDs/types or independently reminting the graph.
test('typed graph preserves canonical IDs/types and revision without execution authority',()=>{
  const revision=twin(),view=api('projectTwinGraph')({tenant:'alpha',revision});
  assert.equal(view.sourceTwinRevision,revision.revision);
  assert.equal(view.executionAuthority,'NONE');
  assert.equal(view.nodeById('site').type,'site');
  assert.deepEqual(view.relatedAt('site','proven-by',{at:'2026-09-20T10:15:00Z',knownAt:'2026-09-20T10:15:00Z'}).map(x=>x.id),['evidence']);
});
// Break caught: accepting an unrelated tenant or a node/edge overwritten by normalisation.
test('cross-tenant graph, nested node and edge provenance are rejected before normalisation',()=>{
  const project=api('projectTwinGraph');
  assert.throws(()=>project({tenant:'beta',revision:twin()}),/tenant/i);
  const badNode=twin();badNode.nodes[0].tenant='beta';assert.throws(()=>project({tenant:'alpha',revision:badNode}),/tenant/i);
  const badEdge=twin();badEdge.edges[0].tenant='beta';assert.throws(()=>project({tenant:'alpha',revision:badEdge}),/tenant/i);
});
// Break caught: trusting a stale digest or silently discarding an unsupported input type.
test('missing and tampered revision or unsupported type fail closed',()=>{
  const project=api('projectTwinGraph'),tampered=twin();tampered.nodes[0].data.injected=true;
  assert.throws(()=>project({tenant:'alpha',revision:tampered}),/revision|identity/i);
  const missing=twin();delete missing.revision;assert.throws(()=>project({tenant:'alpha',revision:missing}),/revision|identity/i);
  const wrongType=twin();wrongType.nodes[0].type='machine-controller';assert.throws(()=>project({tenant:'alpha',revision:wrongType}),/type/i);
});
// Break caught: source/output aliasing that changes a previously constructed projection.
test('projection is detached and recursively immutable and does not mutate the canonical revision',()=>{
  const revision=twin(),before=JSON.stringify(revision),view=api('projectTwinGraph')({tenant:'alpha',revision});
  assert.equal(JSON.stringify(revision),before);
  revision.nodes.find(x=>x.id==='evidence').data.nested.value=9;
  assert.equal(view.nodeById('evidence').data.nested.value,1);
  assert.throws(()=>{view.nodeById('evidence').data.nested.value=8;},TypeError);
  assert.throws(()=>view.nodes.push({id:'other'}),TypeError);
});
// Break caught: revealing future observed nodes/relationships or including expired relations.
test('relation traversal uses known time and half-open effective windows',()=>{
  const project=api('projectTwinGraph'),view=project({tenant:'alpha',revision:twin()});
  for(const atTime of ['2026-09-20T10:09:59Z','2026-09-20T10:20:00Z'])assert.deepEqual(view.relatedAt('site','proven-by',{at:atTime,knownAt:'2026-09-20T10:30:00Z'}),[]);
  assert.deepEqual(view.relatedAt('site','proven-by',{at:'2026-09-20T10:15:00Z',knownAt:'2026-09-20T09:59:59Z'}),[]);
  const late=twin([node('site','site'),node('evidence','evidence',{},'2026-09-20T10:16:00Z')]);
  assert.deepEqual(project({tenant:'alpha',revision:late}).relatedAt('site','proven-by',{at:'2026-09-20T10:15:00Z',knownAt:'2026-09-20T10:15:00Z'}),[]);
});
// Break caught: allowing invalid validity/provenance timestamps through a canonical contract that accepts strings.
test('projection rejects invalid provenance and inverted relationship validity',()=>{
  const project=api('projectTwinGraph');
  const invalid=twin([node('site','site',{},'not-time')],[]);assert.throws(()=>project({tenant:'alpha',revision:invalid}),/timestamp|time/i);
  const reverse=twin();reverse.edges[0].data.validTo='2026-09-20T10:05:00Z';
  const signed=createTwinRevision(reverse);assert.throws(()=>project({tenant:'alpha',revision:signed}),/valid|window/i);
});

function event(id,occurredAt,observedAt,extra={}){return {id,kind:'inspection',occurredAt,evidence:{sourceRef:'feed:'+id,observedAt},...extra};}
function eventTwin(events){return twin([node('evidence','evidence',{operationalEvents:events})],[]);}
const replayEvents=()=>[
  event('late','2026-09-20T10:02:00Z','2026-09-20T10:20:00Z'),
  event('anchor','2026-09-20T10:01:00Z','2026-09-20T10:01:00Z'),
  event('quick','2026-09-20T10:03:00Z','2026-09-20T10:03:30Z')
];
// Break caught: sorting by arrival or leaking late telemetry into historical replay.
test('history sorts by occurrence but excludes telemetry learned after knownAt',()=>{
  const history=api('projectOperationalHistory')({tenant:'alpha',revision:eventTwin(replayEvents())});
  assert.deepEqual(history.orderedEvents.map(x=>x.id),['anchor','late','quick']);
  const window={from:'2026-09-20T10:00:00Z',to:'2026-09-20T10:10:00Z',knownAt:'2026-09-20T10:10:00Z'};
  assert.deepEqual(history.eventsInWindow(window).map(x=>x.id),['anchor','quick']);
  assert.deepEqual(history.eventsInWindow({...window,knownAt:'2026-09-20T10:21:00Z'}).map(x=>x.id),['anchor','late','quick']);
  assert.deepEqual(history.dataQuality(),{eventCount:3,lateArrivalCount:1,maxIngestionDelayMs:1080000,lateEventIds:['late']});
});
// Break caught: original source leaked anchor ID and related entity metadata even when replay could not know it.
test('incident bundles cannot disclose an anchor not observed at the requested time',()=>{
  const history=api('projectOperationalHistory')({tenant:'alpha',revision:eventTwin(replayEvents())});
  assert.throws(()=>history.incidentBundle({anchorEventId:'late',knownAt:'2026-09-20T10:10:00Z'}),/known|observ/i);
  const bundle=history.incidentBundle({anchorEventId:'anchor',beforeMs:0,afterMs:300000,knownAt:'2026-09-20T10:10:00Z'});
  assert.deepEqual(bundle.events.map(x=>x.id),['anchor','quick']);
  assert.deepEqual(bundle.relatedNodeIds,['evidence']);
  assert.deepEqual(bundle.evidenceRefs,['feed:anchor','feed:quick']);
  assert.equal(bundle.executionAuthority,'NONE');
  assert.match(bundle.claimBoundary,/does not prove causality/);
});
// Break caught: accepting duplicated event identity, impossible provenance, cross-tenant facet or negative tolerance.
test('history rejects ambiguous event IDs and invalid or cross-tenant provenance',()=>{
  const project=api('projectOperationalHistory'),first=replayEvents()[1];
  assert.throws(()=>project({tenant:'alpha',revision:eventTwin([first,first])}),/duplicate/i);
  for(const bad of [event('x','2026-02-31T10:00:00Z','2026-03-04T10:00:00Z'),event('x','2026-09-20T10:01:00Z','2026-09-20T10:00:00Z'),event('x','2026-09-20T10:01:00Z','2026-09-20T10:01:00Z',{tenant:'beta'}),event('x','2026-09-20T10:01:00Z','2026-09-20T10:01:00Z',{evidence:{sourceRef:' ',observedAt:'2026-09-20T10:01:00Z'}})])assert.throws(()=>project({tenant:'alpha',revision:eventTwin([bad])}),/timestamp|observ|tenant|required/i);
  assert.throws(()=>project({tenant:'alpha',revision:eventTwin([first]),lateAfterMs:-1}),/lateAfterMs/i);
});
// Break caught: source/output aliases or accepting unknown filtering scope.
test('history snapshots cannot be altered and filters remain within canonical nodes',()=>{
  const revision=eventTwin(replayEvents()),history=api('projectOperationalHistory')({tenant:'alpha',revision});
  revision.nodes[0].data.operationalEvents[1].kind='tampered';
  assert.equal(history.orderedEvents[0].kind,'inspection');
  assert.throws(()=>{history.orderedEvents[0].evidence.sourceRef='other';},TypeError);
  assert.throws(()=>history.eventsInWindow({from:at,to:'2026-09-20T10:30:00Z',knownAt:'2026-09-20T10:30:00Z',nodeIds:['unknown']}),/node/i);
});

function engineering(id,partId='part:'+id,extra={},observedAt='2026-09-20T10:01:00Z'){
  return node(id,'evidence',{engineeringRecord:{partId,revision:'B',searchTokens:['pump','steel'],engineeringVector:[1,0],geometryVector:[1,0],material:'steel',process:'cast',evidence:{sourceRef:'drawing:'+id,observedAt},...extra}});
}
function engineeringTwin(nodes){return twin(nodes,[]);}
function drawingNodes(){return [
  engineering('query','part:A',{previousRevisionId:'previous'}),
  engineering('previous','part:A',{revision:'A'},'2026-09-20T10:00:00Z'),
  engineering('same','part:B',{},'2026-09-20T10:02:00Z'),
  engineering('different','part:C',{searchTokens:['pump','iron'],engineeringVector:[0,1],geometryVector:[0,1],material:'iron'},'2026-09-20T10:02:00Z'),
  engineering('future','part:D',{},'2026-09-20T10:20:00Z')
];}
// Break caught: inventing similarity, changing weights, including future records, or treating source IDs as new entities.
test('engineering similarity is evidence-backed, hand-ranked and as-known-at scoped',()=>{
  const memory=api('projectEngineeringMemory')({tenant:'alpha',revision:engineeringTwin(drawingNodes())});
  const results=memory.similarTo('query',{knownAt:'2026-09-20T10:10:00Z'});
  assert.deepEqual(results.map(x=>[x.nodeId,x.score]),[['same',1],['different',0.1167]]);
  assert.deepEqual(results[0].evidenceRefs,['drawing:query','drawing:same']);
  assert.equal(memory.executionAuthority,'NONE');
  assert.match(results[0].claimBoundary,/supplied.*features/i);
  assert.deepEqual(memory.similarTo('query',{knownAt:'2026-09-20T10:10:00Z',minimumScore:0.5}).map(x=>x.nodeId),['same']);
  assert.throws(()=>memory.similarTo('future',{knownAt:'2026-09-20T10:10:00Z'}),/known/i);
});
// Break caught: cross-part/dangling/cyclic lineage surviving construction.
test('engineering lineage follows canonical nodes and rejects dangling, cross-part and cyclic predecessors',()=>{
  const project=api('projectEngineeringMemory'),memory=project({tenant:'alpha',revision:engineeringTwin(drawingNodes())});
  assert.deepEqual(memory.revisionChain('query',{knownAt:'2026-09-20T10:10:00Z'}).map(x=>x.nodeId),['query','previous']);
  for(const bad of [
    [engineering('a','P',{previousRevisionId:'missing'})],
    [engineering('a','P',{previousRevisionId:'b'}),engineering('b','Q')],
    [engineering('a','P',{previousRevisionId:'b'}),engineering('b','P',{previousRevisionId:'a'})]
  ])assert.throws(()=>project({tenant:'alpha',revision:engineeringTwin(bad)}),/lineage|previous|cycle/i);
});
// Break caught: accepting non-evidence facets, tenant misbinding, empty provenance and nonsensical vectors.
test('engineering facets reject malformed evidence and vectors before querying',()=>{
  const project=api('projectEngineeringMemory');
  const badType=engineering('x');badType.type='person';
  const badTenant=engineering('x');badTenant.data.engineeringRecord.tenant='beta';
  const badSource=engineering('x','P',{evidence:{sourceRef:' ',observedAt:'2026-09-20T10:01:00Z'}});
  const badZero=engineering('x','P',{engineeringVector:[0,0]});
  const badString=engineering('x','P',{engineeringVector:['1',0]});
  for(const bad of [badType,badTenant,badSource,badZero,badString])assert.throws(()=>project({tenant:'alpha',revision:engineeringTwin([bad])}),/evidence|tenant|required|vector|finite/i);
});
// Break caught: overflowing valid finite supplied vectors and manufacturing bogus zero/nonfinite similarity.
test('large finite vectors retain a valid cosine score without overflow',()=>{
  const huge={engineeringVector:[1e308,1e308],geometryVector:[1e308,1e308]};
  const memory=api('projectEngineeringMemory')({tenant:'alpha',revision:engineeringTwin([engineering('a','A',huge),engineering('b','B',huge)])});
  assert.equal(memory.similarTo('a',{knownAt:'2026-09-20T10:10:00Z'})[0].score,1);
});
// Break caught: accepting mismatched dimensions or returning a meaningless no-evidence score.
test('incomparable feature dimensions and absent signals fail closed',()=>{
  const project=api('projectEngineeringMemory'),unequal=project({tenant:'alpha',revision:engineeringTwin([engineering('a'),engineering('b','B',{engineeringVector:[1,0,0]})])});
  assert.throws(()=>unequal.similarTo('a',{knownAt:'2026-09-20T10:10:00Z'}),/dimension/i);
  const empty={searchTokens:[],engineeringVector:null,geometryVector:null,material:null,process:null};
  const unknown=project({tenant:'alpha',revision:engineeringTwin([engineering('a','A',empty),engineering('b','B',empty)])});
  assert.throws(()=>unknown.similarTo('a',{knownAt:'2026-09-20T10:10:00Z'}),/comparable|signal/i);
});
// Break caught: aliasing source feature arrays or accepting an unbounded/invalid query option.
test('engineering results are detached, immutable and bounded by validated query options',()=>{
  const revision=engineeringTwin(drawingNodes()),memory=api('projectEngineeringMemory')({tenant:'alpha',revision});
  revision.nodes.find(x=>x.id==='query').data.engineeringRecord.searchTokens.push('mutated');
  const results=memory.similarTo('query',{knownAt:'2026-09-20T10:10:00Z',limit:1});
  assert.equal(results.length,1);assert.equal(results[0].score,1);
  assert.throws(()=>{results[0].signals.text=0;},TypeError);
  assert.throws(()=>memory.similarTo('query',{knownAt:'2026-09-20T10:10:00Z',limit:0}),/limit/i);
  assert.throws(()=>memory.similarTo('query',{knownAt:'2026-09-20T10:10:00Z',minimumScore:2}),/minimumScore/i);
});

// Break caught: an expired source node still exposing its outgoing relations.
test('relation traversal excludes a source outside its own effective validity',()=>{
  const revision=twin([node('site','site',{validTo:'2026-09-20T10:12:00Z'}),node('evidence','evidence')]);
  const view=api('projectTwinGraph')({tenant:'alpha',revision});
  assert.deepEqual(view.relatedAt('site','proven-by',{at:'2026-09-20T10:15:00Z',knownAt:'2026-09-20T10:15:00Z'}),[]);
});
// Break caught: whitespace-only canonical source is accepted as traceable provenance.
test('projection rejects canonical provenance with no nonempty source identity',()=>{
  const record=node('site','site');record.source=' ';
  const revision=twin([record],[]);
  assert.throws(()=>api('projectTwinGraph')({tenant:'alpha',revision}),/source|required/i);
});
