function fail(message,code='WFM_JSON_RECORDS_INVALID'){const e=new Error(message);e.code=code;throw e;}
function text(value,name,max=128){
  if(typeof value!=='string'||!value.trim())fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(name+' is invalid');
  return v;
}
function path(value,name){
  if(!Array.isArray(value)||!value.length||value.length>32)fail(name+' must contain 1-32 segments');
  return value.map((v,i)=>{
    const s=text(v,name+'['+i+']');
    if(!/^[A-Za-z0-9_$-]+$/.test(s)||['__proto__','prototype','constructor'].includes(s))fail(name+' contains unsafe segment');
    return s;
  });
}
function get(value,parts){
  let current=value;
  for(const part of parts){
    if(!current||typeof current!=='object'||Array.isArray(current)||!Object.hasOwn(current,part))return undefined;
    current=current[part];
  }
  return current;
}
function clonePlain(value,pathName,depth=0,nodes={count:0},maxNodes=100000){
  nodes.count++;
  if(nodes.count>maxNodes||depth>64)fail('JSON structure exceeds configured limit','WFM_JSON_RECORDS_LIMIT');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value))fail(pathName+' contains non-finite number');
    return value;
  }
  if(Array.isArray(value))return value.map((v,i)=>clonePlain(v,pathName+'['+i+']',depth+1,nodes,maxNodes));
  if(!value||typeof value!=='object'||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(pathName+' must be plain JSON');
  const out={};
  for(const [k,v] of Object.entries(value)){
    if(['__proto__','prototype','constructor'].includes(k))fail(pathName+' contains unsafe key');
    out[k]=clonePlain(v,pathName+'.'+k,depth+1,nodes,maxNodes);
  }
  return out;
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

export function extractJsonRecords({data,recordPath,maxRecords=100000,maxNodes=100000}={}){
  const parts=path(recordPath,'recordPath');
  const list=get(data,parts);
  if(!Array.isArray(list))fail('recordPath does not resolve to an array');
  if(list.length>maxRecords)fail('record count exceeds configured limit','WFM_JSON_RECORDS_LIMIT');
  const nodes={count:0};
  const records=list.map((item,i)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))fail('record '+i+' must be an object');
    return clonePlain(item,'record['+i+']',0,nodes,maxNodes);
  });
  return freeze(records);
}
