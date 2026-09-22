import crypto from 'node:crypto';

const CORE_DIMENSIONS=['providerId','connectionId','resource'];
const OPTIONAL_DIMENSIONS=[
  'tenant','environment','serverInstance','entity','company','site','region','countryCode','apiVersion','dataset'
];
const ALLOWED_DIMENSIONS=new Set([...CORE_DIMENSIONS,...OPTIONAL_DIMENSIONS]);

function normaliseValue(value,key){
  if(value===undefined||value===null||value==='') return null;
  const text=String(value).normalize('NFC').trim();
  if(!text) return null;
  if(text.includes('\0')) throw new Error(`Invalid NUL in source scope dimension: ${key}`);
  return text;
}

export function buildSourceScope(input,{requiredDimensions=[]}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Source scope must be an object.');
  const required=[...new Set([...CORE_DIMENSIONS,...requiredDimensions])];
  for(const key of required){
    if(!ALLOWED_DIMENSIONS.has(key)) throw new Error(`Unsupported required source scope dimension: ${key}`);
  }

  const canonical={};
  for(const key of [...CORE_DIMENSIONS,...OPTIONAL_DIMENSIONS]){
    const value=normaliseValue(input[key],key);
    if(value!==null) canonical[key]=value;
  }

  const missing=required.filter(key=>canonical[key]===undefined);
  if(missing.length) throw new Error(`Missing required source scope dimensions: ${missing.join(', ')}`);

  const serialised=JSON.stringify(canonical);
  const digest=crypto.createHash('sha256').update(serialised,'utf8').digest('hex');
  return {
    schemaVersion:1,
    dimensions:canonical,
    checkpointNamespace:`scope:v1:${digest}`
  };
}

export function assertCheckpointScope(checkpoint,scope){
  if(!checkpoint?.scopeNamespace) throw new Error('Checkpoint is missing its source scope namespace.');
  if(!scope?.checkpointNamespace) throw new Error('Current source scope is missing a checkpoint namespace.');
  if(checkpoint.scopeNamespace!==scope.checkpointNamespace){
    throw new Error('Checkpoint source scope mismatch; start a new checkpoint namespace and recover with overlap replay/reconciliation.');
  }
  return true;
}

export function lineageScope(scope){
  if(!scope?.dimensions||!scope?.checkpointNamespace) throw new Error('Invalid source scope.');
  return {
    sourceScopeSchemaVersion:scope.schemaVersion||1,
    sourceScope:structuredClone(scope.dimensions),
    checkpointNamespace:scope.checkpointNamespace
  };
}
