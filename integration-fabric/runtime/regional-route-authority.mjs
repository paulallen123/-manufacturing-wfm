function nonEmpty(value,name){
  const text=String(value??'').normalize('NFC').trim();
  if(!text) throw new TypeError(`${name} is required`);
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}

function canonicalHost(value){
  const raw=nonEmpty(value,'endpoint host').toLowerCase();
  if(raw.includes('*')||raw.includes('/')||raw.includes('@')) throw new TypeError('endpoint host must be an exact host, not a wildcard, path, or credential-bearing value');
  const url=new URL(`https://${raw}`);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash) throw new TypeError('endpoint host must be an exact host only');
  return url.host;
}

function unique(values){return [...new Set((values||[]).map(value=>nonEmpty(value,'route value')))];}

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value)) return value;
  for(const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createRegionalRoutePolicy({providerId,routes=[]}={}){
  const provider=nonEmpty(providerId,'providerId');
  if(!Array.isArray(routes)||routes.length===0) throw new TypeError('at least one regional route is required');
  const ids=new Set();
  const normalized=routes.map((route,index)=>{
    if(!route||typeof route!=='object'||Array.isArray(route)) throw new TypeError(`route ${index} must be an object`);
    const id=nonEmpty(route.id,`routes[${index}].id`);
    if(ids.has(id)) throw new TypeError(`duplicate route id: ${id}`);
    ids.add(id);
    const hosts=unique(route.endpointHosts).map(canonicalHost);
    if(hosts.length===0) throw new TypeError(`route ${id} requires at least one exact endpoint host`);
    return {
      id,
      region:nonEmpty(route.region,`route ${id} region`),
      dataLocation:nonEmpty(route.dataLocation,`route ${id} dataLocation`),
      endpointHosts:[...new Set(hosts)],
      allowedTransferDestinations:unique(route.allowedTransferDestinations),
      sourceCountries:unique(route.sourceCountries),
      customerChosenDataLocation:route.customerChosenDataLocation===true
    };
  });
  return deepFreeze({
    schemaVersion:1,
    providerId:provider,
    routes:normalized,
    silentCrossRegionFailoverAllowed:false,
    customerApprovalRequiredForCrossRegionTransfer:true,
    exactEndpointAuthorityRequired:true
  });
}

function routeById(policy,routeId){
  if(!policy||policy.schemaVersion!==1||!Array.isArray(policy.routes)) throw new TypeError('invalid regional route policy');
  const id=nonEmpty(routeId,'routeId');
  const route=policy.routes.find(entry=>entry.id===id);
  if(!route) throw new Error(`regional route is not allowlisted: ${id}`);
  return route;
}

export function authorizeRegionalRoute({policy,routeId,endpointUrl,destinationRegion=null,customerApprovedTransfer=false}={}){
  const route=routeById(policy,routeId);
  const url=new URL(nonEmpty(endpointUrl,'endpointUrl'));
  if(url.protocol!=='https:') throw new Error('regional route requires HTTPS');
  if(url.username||url.password) throw new Error('regional route endpoint must not contain credentials');
  const host=url.host.toLowerCase();
  if(!route.endpointHosts.includes(host)) throw new Error(`endpoint host is not allowlisted for regional route ${route.id}`);

  const destination=destinationRegion===null||destinationRegion===undefined||destinationRegion===''
    ? route.region
    : nonEmpty(destinationRegion,'destinationRegion');
  const crossRegion=destination!==route.region;
  if(crossRegion){
    if(!route.allowedTransferDestinations.includes(destination)) throw new Error(`cross-region destination is not allowlisted: ${destination}`);
    if(customerApprovedTransfer!==true) throw new Error('cross-region transfer requires explicit customer approval');
  }

  return deepFreeze({
    providerId:policy.providerId,
    routeId:route.id,
    region:route.region,
    dataLocation:route.dataLocation,
    endpointHost:host,
    destinationRegion:destination,
    crossRegionTransfer:crossRegion,
    silentFailoverAllowed:false,
    checkpointDimensions:{routeId:route.id,region:route.region,dataLocation:route.dataLocation}
  });
}

export function assessRegionalRouteTransition({policy,fromRouteId,toRouteId,customerApprovedTransfer=false}={}){
  const from=routeById(policy,fromRouteId);
  const to=routeById(policy,toRouteId);
  if(from.id===to.id){
    return deepFreeze({allowed:true,crossRegion:false,requiresNewCheckpointNamespace:false,requiresReconciliation:false,silentFailoverAllowed:false});
  }
  const crossRegion=from.region!==to.region;
  if(crossRegion){
    if(!from.allowedTransferDestinations.includes(to.region)) throw new Error(`cross-region failover destination is not allowlisted: ${to.region}`);
    if(customerApprovedTransfer!==true) throw new Error('cross-region failover requires explicit customer approval');
  }
  return deepFreeze({
    allowed:true,
    crossRegion,
    requiresNewCheckpointNamespace:true,
    requiresReconciliation:true,
    silentFailoverAllowed:false,
    from:{routeId:from.id,region:from.region,dataLocation:from.dataLocation},
    to:{routeId:to.id,region:to.region,dataLocation:to.dataLocation}
  });
}
