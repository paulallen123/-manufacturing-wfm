const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'policy/runtime');
const names=['authoritative-policy-source-registry','country-policy-pack-registry','jurisdiction-policy-graph','global-site-policy-preflight'];
const helpers=`
const { inertJsonCopy } = require('../../implementation/runtime/inert-finite-json.cjs');
const { types } = require('node:util');
function inputCopy(value){return inertJsonCopy(value,'policy input');}
function freezeTree(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freezeTree(child);Object.freeze(value);}return value;}
function immutable(value){return freezeTree(JSON.parse(JSON.stringify(inputCopy(value))));}
// Factory collaborators are trusted configuration, never policy/worker data.
function collaborator(options,key,fallback){
  if(!options||typeof options!=='object'||types.isProxy(options)||Object.getPrototypeOf(options)!==Object.prototype)throw Error('Invalid trusted factory configuration');
  const descriptors=Object.getOwnPropertyDescriptors(options);
  for(const descriptor of Object.values(descriptors))if(!Object.hasOwn(descriptor,'value'))throw Error('Factory configuration cannot contain accessors');
  return descriptors[key]?descriptors[key].value:fallback;
}
`;
for(const name of names){let s=fs.readFileSync(path.join(dir,name+'.cjs'),'utf8');s=s.replace("'use strict';","'use strict';\n"+helpers);
// The exported serializer is itself a data boundary; recursive serialization is private.
s=s.replace('function stable(', 'function stableValue(').replace(/\.map\(stable\)/g,'.map(stableValue)').replace(/\+stable\(/g,'+stableValue(');
s=s.replace('function digest(',"function stable(value){return stableValue(inputCopy(value));}\nfunction digest(");
s=s.replace(/function clone\(v\)\{[^\n]+\}/,"function clone(v){return v==null?v:JSON.parse(JSON.stringify(inputCopy(v)));}");
if(name==='authoritative-policy-source-registry'){
 s=s.replace('function normaliseSource(input={}){','function normaliseSource(input={}){\n  input=inputCopy(input);');
 s=s.replace('  const core={contractVersion:',"  if(!Number.isFinite(freshnessHours))throw Error('Source freshnessHours must be finite.');\n  const core={contractVersion:");
 s=s.replace('return Object.freeze({...core,sourceDigest:digest(core)})','return immutable({...core,sourceDigest:digest(core)})');
 s=s.replace('function createAuthoritativePolicySourceRegistry(initial=[]){',`function createAuthoritativePolicySourceRegistry(initial=[],options={}){
  initial=inputCopy(initial);if(!Array.isArray(initial))throw Error('Initial sources must be an array');
  const clock=collaborator(options,'clock',Date.now);if(typeof clock!=='function')throw Error('Trusted clock must be a function');`);
 s=s.replace('  function recordSnapshot(input={}){','  function recordSnapshot(input={}){\n    input=inputCopy(input);');
 s=s.replace('    const core={contractVersion:',"    const admissionTime=clock();if(typeof admissionTime!=='number'||!Number.isFinite(admissionTime)||!Number.isFinite(new Date(admissionTime).getTime()))throw Error('Trusted clock must return finite epoch milliseconds');\n    const ingestedAt=new Date(admissionTime).toISOString();\n    const core={contractVersion:");
 s=s.replace('sourceDigest:source.sourceDigest,observedAt,','sourceDigest:source.sourceDigest,observedAt,ingestedAt,');
 s=s.replace('const receipt=Object.freeze({...core,snapshotDigest:digest(core)})','const receipt=immutable({...core,snapshotDigest:digest(core)})');
 s=s.replace('function latest(sourceId){','function latest(sourceId){sourceId=inputCopy(sourceId);');
 s=s.replace('function assess(sourceId,{at=new Date().toISOString()}={}){',"function assess(sourceId,options={}){\n    sourceId=inputCopy(sourceId);options=inputCopy(options);const at=options.at===undefined?new Date().toISOString():options.at;");
 s=s.replace('    const ageHours=',"    if(Date.parse(snap.observedAt)>Date.parse(atIso)||Date.parse(snap.ingestedAt)>Date.parse(atIso))return immutable({sourceId:source.id,state:'FUTURE',usable:false,requiresAttention:true,snapshotDigest:snap.snapshotDigest});\n    const ageHours=");
 s=s.replace('function all(){return [...sources.values()].sort((a,b)=>a.id.localeCompare(b.id));}', 'function all(){return immutable([...sources.values()].sort((a,b)=>a.id.localeCompare(b.id)));}');
}
if(name==='country-policy-pack-registry'){
 for(const [func,param]of [['normaliseRule','rule'],['normalisePack','pack']])s=s.replace(`function ${func}(${param}={}){`,`function ${func}(${param}={}){\n  ${param}=inputCopy(${param});`);
 s=s.replace('return Object.freeze({id,domain,effect,','return immutable({id,domain,effect,').replace('return Object.freeze({...core,packDigest:digest(core)})','return immutable({...core,packDigest:digest(core)})');
 s=s.replace('function createCountryPolicyPackRegistry(initial=[]){',"function createCountryPolicyPackRegistry(initial=[]){\n  initial=inputCopy(initial);if(!Array.isArray(initial))throw Error('Initial packs must be an array');");
 s=s.replace('function all(){return [...packs.values()].sort((a,b)=>a.country.localeCompare(b.country)||a.id.localeCompare(b.id)||a.version.localeCompare(b.version));}', 'function all(){return immutable([...packs.values()].sort((a,b)=>a.country.localeCompare(b.country)||a.id.localeCompare(b.id)||a.version.localeCompare(b.version)));}');
 s=s.replace('function resolve(input={}){','function resolve(input={}){\n    input=inputCopy(input);').replace("return Object.freeze({contractVersion:'VECTOR_COUNTRY_POLICY_CONTEXT_V1'","return immutable({contractVersion:'VECTOR_COUNTRY_POLICY_CONTEXT_V1'");
}
if(name==='jurisdiction-policy-graph'){
 s=s.replace('function normaliseRule(rule={},node={}){','function normaliseRule(rule={},node={}){\n  rule=inputCopy(rule);node=inputCopy(node);').replace('function normaliseNode(node={}){','function normaliseNode(node={}){\n  node=inputCopy(node);');
 s=s.replace('return Object.freeze({...core,ruleDigest:digest(core)})','return immutable({...core,ruleDigest:digest(core)})').replace('return Object.freeze({...core,nodeDigest:digest(core)})','return immutable({...core,nodeDigest:digest(core)})');
 s=s.replace('function composeRuleSet(rules=[]){','function composeRuleSet(rules=[]){\n  rules=inputCopy(rules);if(!Array.isArray(rules))throw Error(\'Rules must be an array\');');
 // Group comparison by exact numeric unit. Preserve global deny priority and include
 // nonnumeric requirements/exception review once, independent of numeric units.
 s=s.replace("    const floors=items.filter",`    const numeric=items.filter(x=>['MIN','MAX'].includes(x.rule.operator));
    const units=[...new Set(numeric.map(x=>x.rule.unit||null))];
    if(units.length>1)review.push({key,reason:'INCOMPATIBLE_RULE_UNITS',units:units.slice().sort((a,b)=>String(a).localeCompare(String(b))),ruleIds:numeric.map(x=>x.rule.id)});
    const comparisonGroups=units.length>1?units.map(unit=>items.filter(x=>['MIN','MAX'].includes(x.rule.operator)&&((x.rule.unit||null)===unit))):[items];
    if(units.length>1)comparisonGroups.push(items.filter(x=>!['MIN','MAX'].includes(x.rule.operator)));
    for(const group of comparisonGroups){
    const floors=group.filter`);
 for(const v of ['ceilings','entitlements','requirements','customer','exceptions','info'])s=s.replace(`const ${v}=items.filter`,`const ${v}=group.filter`);
 s=s.replace("constraints.find(c=>c.key===key&&c.result==='MAX'),mandatoryMin=constraints.find(c=>c.key===key&&c.result==='MIN')", "constraints.find(c=>c.key===key&&c.result==='MAX'&&c.unit===(x.rule.unit||null)),mandatoryMin=constraints.find(c=>c.key===key&&c.result==='MIN'&&c.unit===(x.rule.unit||null))");
 s=s.replace("  return {constraints,review,informational};","    }\n  return immutable({constraints,review,informational});");
 s=s.replace('function createJurisdictionPolicyGraph(initial=[]){',"function createJurisdictionPolicyGraph(initial=[]){\n  initial=inputCopy(initial);if(!Array.isArray(initial))throw Error('Initial nodes must be an array');");
 s=s.replace('function all(){return [...nodes.values()].sort((a,b)=>LAYERS.indexOf(a.layer)-LAYERS.indexOf(b.layer)||a.id.localeCompare(b.id));}', 'function all(){return immutable([...nodes.values()].sort((a,b)=>LAYERS.indexOf(a.layer)-LAYERS.indexOf(b.layer)||a.id.localeCompare(b.id)));}');
 s=s.replace('function resolve(input={}){','function resolve(input={}){\n    input=inputCopy(input);').replace('return Object.freeze({...clone(payload),contextDigest:digest(payload)})','return immutable({...clone(payload),contextDigest:digest(payload)})');
}
if(name==='global-site-policy-preflight'){
 s=s.replace('function createGlobalSitePolicyPreflight({graph}={}){',"function createGlobalSitePolicyPreflight(options={}){\n  const graph=collaborator(options,'graph',null);");
 s=s.replace('function assess(input={}){','function assess(input={}){\n    input=inputCopy(input);');
 s=s.replace('    const results=[];',`    if(input.workers!==undefined&&!Array.isArray(input.workers))throw Error('Supplied workers must be an array');
    const ids=new Set();
    for(const worker of workers){const id=text(worker?.id,160);if(!id||ids.has(id))throw Error('Supplied worker identity must be present and unique');ids.add(id);}
    const results=[];`);
 s=s.replace("const workerId=text(worker.id,160); if(!workerId) continue;","const workerId=text(worker.id,160);");
 s=s.replace("graph.resolve({legalAt:input.legalAt,knownAt:input.knownAt,context})", "graph.resolve({...input.legalAt===undefined?{}:{legalAt:input.legalAt},...input.knownAt===undefined?{}:{knownAt:input.knownAt},context})");
 s=s.replace('return Object.freeze({...payload,preflightDigest:digest(payload)})','return immutable({...payload,preflightDigest:digest(payload)})');
}
fs.writeFileSync(path.join(dir,name+'.cjs'),s);
}
