'use strict';

// Adapted PR205 query semantics. Canonical TwinRevision remains the sole state owner.
// Import the existing canonical twin contract at its repository-relative location.
const {createTwinRevision,stable}=require('./implementation-digital-twin.cjs');

function requireThat(condition,message){if(!condition)throw new Error(message);}
function freeze(value){
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
function time(value,label){
  requireThat(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value),label+' requires a UTC ISO timestamp');
  const normalized=value.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>'.'+String(fraction||'').padEnd(3,'0')+'Z');
  const result=Date.parse(value);
  requireThat(Number.isFinite(result)&&new Date(result).toISOString()===normalized,label+' has an invalid timestamp');
  return result;
}
function nonempty(value,label){requireThat(typeof value==='string'&&value.trim().length>0,label+' is required');return value;}
function validity(record,label){
  const from=record.effectiveAt==null?-Infinity:time(record.effectiveAt,label+'.effectiveAt');
  const to=record.data?.validTo==null?Infinity:time(record.data.validTo,label+'.validTo');
  requireThat(from<to,label+' validity window must be increasing');
  return {from,to};
}
function canonical({tenant,revision}={}){
  nonempty(tenant,'tenant');
  requireThat(revision&&revision.tenant===tenant,'Cross-tenant canonical twin denied');
  requireThat(typeof revision.revision==='string'&&/^[a-f0-9]{64}$/.test(revision.revision),'Canonical revision identity is required');
  requireThat(Array.isArray(revision.nodes)&&Array.isArray(revision.edges),'Canonical revision nodes/edges are required');
  for(const record of [...revision.nodes,...revision.edges])requireThat(record&&record.tenant===tenant,'Cross-tenant node/edge denied');
  const reconstructed=createTwinRevision(revision);
  requireThat(reconstructed.revision===revision.revision,'Canonical twin revision identity mismatch');
  const supplied={tenant:revision.tenant,nodes:revision.nodes,edges:revision.edges};
  const normalized={tenant:reconstructed.tenant,nodes:reconstructed.nodes,edges:reconstructed.edges};
  requireThat(stable(supplied)===stable(normalized),'Canonical twin content is not normalized');
  for(const record of [...reconstructed.nodes,...reconstructed.edges]){
    nonempty(record.source,'Canonical provenance source');
    time(record.observedAt,'Canonical provenance observedAt');
    validity(record,'Canonical record');
  }
  return freeze(reconstructed);
}
function header(revision){return {tenant:revision.tenant,sourceTwinRevision:revision.revision,executionAuthority:'NONE'};}
function projectTwinGraph(input){
  const revision=canonical(input),nodes=new Map(revision.nodes.map(node=>[node.id,node]));
  return Object.freeze({
    ...header(revision),nodes:revision.nodes,edges:revision.edges,
    nodeById(id){return nodes.get(id)||null;},
    relatedAt(from,relation,{at,knownAt}={}){
      const atMs=time(at,'at'),knownMs=time(knownAt,'knownAt');
      const source=nodes.get(from);
      if(!source||time(source.observedAt,'source.observedAt')>knownMs)return Object.freeze([]);
      const sourceWindow=validity(source,'source');
      if(atMs<sourceWindow.from||atMs>=sourceWindow.to)return Object.freeze([]);
      const seen=new Set(),result=[];
      for(const edge of revision.edges){
        if(edge.from!==from||(relation&&edge.relation!==relation))continue;
        const target=nodes.get(edge.to),edgeWindow=validity(edge,'edge'),targetWindow=validity(target,'target');
        if(time(edge.observedAt,'edge.observedAt')>knownMs||time(target.observedAt,'target.observedAt')>knownMs)continue;
        if(atMs<edgeWindow.from||atMs>=edgeWindow.to||atMs<targetWindow.from||atMs>=targetWindow.to)continue;
        if(!seen.has(target.id)){seen.add(target.id);result.push(target);}
      }
      return Object.freeze(result);
    }
  });
}

function projectOperationalHistory(input={}){
  const revision=canonical(input),lateAfterMs=input.lateAfterMs??60000;
  requireThat(Number.isFinite(lateAfterMs)&&lateAfterMs>=0,'lateAfterMs must be nonnegative');
  const nodes=new Set(revision.nodes.map(node=>node.id)),byId=new Map(),ordered=[];
  for(const node of revision.nodes){
    const events=node.data.operationalEvents??[];
    requireThat(Array.isArray(events),'operationalEvents must be an array');
    for(const event of events){
      requireThat(event&&typeof event==='object','Operational event is required');
      nonempty(event.id,'event.id');nonempty(event.kind,'event.kind');
      requireThat(!byId.has(event.id),'Duplicate operational event id');
      requireThat(event.tenant==null||event.tenant===revision.tenant,'Cross-tenant event denied');
      const occurredMs=time(event.occurredAt,'event.occurredAt'),observedMs=time(event.evidence?.observedAt,'event.evidence.observedAt');
      nonempty(event.evidence?.sourceRef,'event.evidence.sourceRef');
      requireThat(observedMs>=occurredMs&&observedMs>=time(node.observedAt,'node.observedAt'),'Event observation contradicts canonical provenance');
      const row=freeze({id:event.id,kind:event.kind,nodeId:node.id,occurredAt:event.occurredAt,evidence:{sourceRef:event.evidence.sourceRef,observedAt:event.evidence.observedAt},occurredMs,observedMs,ingestionDelayMs:observedMs-occurredMs,lateArrival:observedMs-occurredMs>lateAfterMs});
      byId.set(row.id,row);ordered.push(row);
    }
  }
  ordered.sort((a,b)=>a.occurredMs-b.occurredMs||a.observedMs-b.observedMs||a.id.localeCompare(b.id));
  Object.freeze(ordered);
  function eventsInWindow({from,to,knownAt,nodeIds,kinds}={}){
    const fromMs=time(from,'from'),toMs=time(to,'to'),knownMs=time(knownAt,'knownAt');
    requireThat(fromMs<=toMs,'Time window must be increasing');
    if(nodeIds!==undefined){requireThat(Array.isArray(nodeIds),'nodeIds must be an array');for(const id of nodeIds)requireThat(nodes.has(id),'Unknown canonical node filter');}
    if(kinds!==undefined){requireThat(Array.isArray(kinds),'kinds must be an array');for(const kind of kinds)nonempty(kind,'kind filter');}
    return Object.freeze(ordered.filter(event=>event.occurredMs>=fromMs&&event.occurredMs<=toMs&&event.observedMs<=knownMs&&(!nodeIds||nodeIds.includes(event.nodeId))&&(!kinds||kinds.includes(event.kind))));
  }
  return Object.freeze({
    ...header(revision),orderedEvents:ordered,eventsInWindow,
    incidentBundle({anchorEventId,beforeMs=900000,afterMs=900000,knownAt}={}){
      const knownMs=time(knownAt,'knownAt'),anchor=byId.get(anchorEventId);
      requireThat(anchor&&anchor.observedMs<=knownMs,'Anchor is not known at the requested observation time');
      requireThat(Number.isFinite(beforeMs)&&beforeMs>=0&&Number.isFinite(afterMs)&&afterMs>=0,'Incident window must be nonnegative');
      const from=new Date(anchor.occurredMs-beforeMs).toISOString(),to=new Date(anchor.occurredMs+afterMs).toISOString();
      const events=eventsInWindow({from,to,knownAt,nodeIds:[anchor.nodeId]});
      return freeze({...header(revision),anchorEventId,from,to,knownAt,relatedNodeIds:[anchor.nodeId],events,evidenceRefs:[...new Set(events.map(event=>event.evidence.sourceRef))],claimBoundary:'Sequence/context only. Temporal adjacency does not prove causality.'});
    },
    dataQuality(){const late=ordered.filter(event=>event.lateArrival);return freeze({eventCount:ordered.length,lateArrivalCount:late.length,maxIngestionDelayMs:late.reduce((max,event)=>Math.max(max,event.ingestionDelayMs),0),lateEventIds:late.map(event=>event.id)});}
  });
}

function featureVector(vector,label){
  if(vector==null)return null;
  requireThat(Array.isArray(vector)&&vector.length>0,label+' must be a nonempty vector');
  for(const value of vector)requireThat(typeof value==='number'&&Number.isFinite(value),label+' vector components must be finite numbers');
  const scale=vector.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
  requireThat(scale>0,label+' vector must not be zero');
  // Scaling first preserves valid finite features when a naive sum of squares overflows.
  return Object.freeze(vector.map(value=>value/scale));
}
function cosine(left,right){
  if(!left||!right)return null;
  requireThat(left.length===right.length,'Comparable vector dimensions must match');
  let dot=0,a=0,b=0;
  for(let i=0;i<left.length;i++){dot+=left[i]*right[i];a+=left[i]*left[i];b+=right[i]*right[i];}
  return Math.max(0,Math.min(1,dot/(Math.sqrt(a)*Math.sqrt(b))));
}
function textSimilarity(left,right){
  const union=new Set([...left,...right]);
  if(!union.size)return null;
  const other=new Set(right);
  return left.filter(token=>other.has(token)).length/union.size;
}
function exactSignal(left,right){return left&&right?(left===right?1:0):null;}
function projectEngineeringMemory(input={}){
  const revision=canonical(input),byId=new Map();
  for(const node of revision.nodes){
    const facet=node.data.engineeringRecord;
    if(facet==null)continue;
    requireThat(node.type==='evidence','Engineering facets require a canonical evidence node');
    requireThat(facet&&typeof facet==='object'&&!Array.isArray(facet),'Engineering evidence facet is required');
    requireThat(facet.tenant==null||facet.tenant===revision.tenant,'Cross-tenant engineering evidence denied');
    requireThat(facet.id==null||facet.id===node.id,'Engineering evidence identity must be canonical node ID');
    nonempty(facet.partId,'engineering.partId');nonempty(facet.revision,'engineering.revision');
    nonempty(facet.evidence?.sourceRef,'engineering.evidence.sourceRef');
    const observedMs=time(facet.evidence?.observedAt,'engineering.evidence.observedAt');
    requireThat(observedMs>=time(node.observedAt,'node.observedAt'),'Engineering observation contradicts canonical provenance');
    const tokens=facet.searchTokens??[];
    requireThat(Array.isArray(tokens)&&tokens.every(token=>typeof token==='string'),'Engineering searchTokens require strings');
    if(facet.previousRevisionId!=null)nonempty(facet.previousRevisionId,'engineering.previousRevisionId');
    for(const key of ['material','process'])requireThat(facet[key]==null||typeof facet[key]==='string','Engineering '+key+' requires a string');
    const record=freeze({nodeId:node.id,partId:facet.partId,revision:facet.revision,previousRevisionId:facet.previousRevisionId??null,searchTokens:[...new Set(tokens.map(token=>token.trim().toLowerCase()).filter(Boolean))].sort(),engineeringVector:featureVector(facet.engineeringVector,'engineering'),geometryVector:featureVector(facet.geometryVector,'geometry'),material:facet.material?.trim().toLowerCase()||null,process:facet.process?.trim().toLowerCase()||null,evidence:{sourceRef:facet.evidence.sourceRef,observedAt:facet.evidence.observedAt},observedMs});
    byId.set(node.id,record);
  }
  for(const record of byId.values()){
    const seen=new Set();let current=record;
    while(current){
      requireThat(!seen.has(current.nodeId),'Engineering revision lineage cycle detected');
      seen.add(current.nodeId);
      if(!current.previousRevisionId)break;
      const previous=byId.get(current.previousRevisionId);
      requireThat(previous&&previous.partId===current.partId,'Engineering previous revision lineage must exist on the same part');
      requireThat(previous.observedMs<=current.observedMs,'Engineering previous revision lineage cannot reference future evidence');
      current=previous;
    }
  }
  function knownRecord(id,knownMs){const row=byId.get(id);requireThat(row&&row.observedMs<=knownMs,'Engineering node is not known at requested time');return row;}
  function compare(left,right){
    const signals={text:textSimilarity(left.searchTokens,right.searchTokens),engineering:cosine(left.engineeringVector,right.engineeringVector),geometry:cosine(left.geometryVector,right.geometryVector),material:exactSignal(left.material,right.material),process:exactSignal(left.process,right.process)};
    const weights={text:0.2,engineering:0.3,geometry:0.35,material:0.1,process:0.05};
    let total=0,weight=0;
    for(const key of Object.keys(signals))if(signals[key]!=null){total+=signals[key]*weights[key];weight+=weights[key];}
    requireThat(weight>0,'No comparable supplied evidence signals');
    return freeze({...header(revision),nodeId:right.nodeId,partId:right.partId,revision:right.revision,score:Math.round(total/weight*10000)/10000,signals,evidenceRefs:[left.evidence.sourceRef,right.evidence.sourceRef],claimBoundary:'Similarity uses supplied evidence-backed features only; no OCR, GD&T or geometry extraction is performed.'});
  }
  return Object.freeze({
    ...header(revision),records:Object.freeze([...byId.values()]),
    revisionChain(id,{knownAt}={}){
      const knownMs=time(knownAt,'knownAt'),result=[];
      let current=knownRecord(id,knownMs);
      while(current){result.push(current);current=current.previousRevisionId?knownRecord(current.previousRevisionId,knownMs):null;}
      return Object.freeze(result);
    },
    similarTo(id,{knownAt,limit=10,minimumScore=0,excludeSamePart=true}={}){
      const knownMs=time(knownAt,'knownAt'),query=knownRecord(id,knownMs);
      requireThat(Number.isInteger(limit)&&limit>0,'limit must be a positive integer');
      requireThat(Number.isFinite(minimumScore)&&minimumScore>=0&&minimumScore<=1,'minimumScore must be between0 and1');
      requireThat(typeof excludeSamePart==='boolean','excludeSamePart must be boolean');
      return Object.freeze([...byId.values()].filter(row=>row.nodeId!==id&&row.observedMs<=knownMs&&(!excludeSamePart||row.partId!==query.partId)).map(row=>compare(query,row)).filter(row=>row.score>=minimumScore).sort((a,b)=>b.score-a.score||a.nodeId.localeCompare(b.nodeId)).slice(0,limit));
    }
  });
}

module.exports=Object.freeze({projectTwinGraph,projectOperationalHistory,projectEngineeringMemory});
