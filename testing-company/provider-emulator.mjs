import crypto from 'node:crypto';
import profiles from './provider-profiles.json' with { type: 'json' };

const clone=value=>structuredClone(value);
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function provider(id){
  const p=profiles.providers.find(item=>item.id===id);
  if(!p) throw new Error('NORTHSTAR_PROVIDER_NOT_FOUND');
  return p;
}

function worker(index){
  return {
    employeeRef:'NS-EMP-'+String(index+1).padStart(6,'0'),
    wid:digest(['wid',index]).slice(0,32),
    referenceId:'NS_WORKER_'+String(index+1).padStart(6,'0'),
    associateOID:digest(['adp',index]).slice(0,16).toUpperCase(),
    firstName:'Worker'+(index+1),
    lastName:'Northstar',
    status:index%23===0?'INACTIVE':'ACTIVE',
    site:'NS-'+String((index%50)+1).padStart(3,'0'),
    revision:7
  };
}

function page(records,offset,limit){
  return records.slice(offset,Math.min(records.length,offset+limit));
}

export function listProviderProfiles(){
  return clone(profiles);
}

export function emulateProviderRequest({providerId,operation='workers',offset=0,limit,tokenState='VALID',fault='none',requestId='northstar-request'}={}){
  const p=provider(providerId);
  const total=237;
  const records=Array.from({length:total},(_,i)=>worker(i));
  const safeOffset=Math.max(0,Number(offset)||0);

  if(tokenState==='EXPIRED'){
    return seal(p,{status:401,headers:{'content-type':'application/json'},body:{error:'invalid_or_expired_token'},terminal:false,retryClass:'REAUTH'});
  }

  if(fault==='rate-limit'){
    return seal(p,{status:429,headers:{'retry-after':'2'},body:{error:'rate_limited'},terminal:false,retryClass:'BACKOFF'});
  }

  if(fault==='schema-drift'){
    return seal(p,{status:200,headers:{'content-type':'application/json'},body:{schemaRevision:'unexpected-v99',records:[{employee_code_new:'NS-EMP-000001'}]},terminal:false,retryClass:'QUARANTINE'});
  }

  if(providerId==='oracle-netsuite'){
    const take=Math.min(Math.max(1,Number(limit)||100),1000);
    const items=page(records,safeOffset,take).map(x=>({id:x.employeeRef,entityid:x.referenceId,isinactive:x.status!=='ACTIVE'}));
    return seal(p,{
      request:{method:'POST',path:'/services/rest/query/v1/suiteql',headers:{Prefer:'transient'},body:{q:'SELECT id, entityid, isinactive FROM employee ORDER BY id'}},
      status:200,
      headers:{'content-type':'application/json'},
      body:{count:items.length,hasMore:safeOffset+items.length<total,items,offset:safeOffset,totalResults:total},
      next:safeOffset+items.length<total?{offset:safeOffset+items.length,limit:take}:null,
      terminal:safeOffset+items.length>=total,retryClass:'NONE'
    });
  }

  if(providerId==='sap-s4hana'){
    const take=Math.min(Math.max(1,Number(limit)||50),100);
    const items=page(records,safeOffset,take).map(x=>({PersonnelNumber:x.employeeRef,EmploymentStatus:x.status,Workplace:x.site}));
    const next=safeOffset+items.length<total?safeOffset+items.length:null;
    return seal(p,{
      request:{method:'GET',path:'/sap/opu/odata4/northstar/Workforce',query:{$top:take,$skiptoken:safeOffset||undefined}},
      status:200,headers:{'content-type':'application/json'},
      body:{'@odata.context':'$metadata#Workforce',value:items,...(next!==null?{'@odata.nextLink':'/Workforce?$skiptoken='+next}: {})},
      next:next!==null?{skiptoken:next}:null,terminal:next===null,retryClass:'NONE'
    });
  }

  if(providerId==='workday'){
    const take=Math.min(Math.max(1,Number(limit)||20),100);
    const data=page(records,safeOffset,take).map(x=>({id:x.wid,descriptor:x.firstName+' '+x.lastName,referenceId:x.referenceId,active:x.status==='ACTIVE'}));
    return seal(p,{
      request:{method:'GET',path:'/workers',query:{limit:take,offset:safeOffset}},
      status:200,headers:{'content-type':'application/json'},
      body:{data,total},
      next:safeOffset+data.length<total?{offset:safeOffset+data.length,limit:take}:null,
      terminal:safeOffset+data.length>=total,retryClass:'NONE'
    });
  }

  if(providerId==='adp-workforce-now'){
    const take=Math.min(Math.max(1,Number(limit)||50),100);
    if(safeOffset>=total){
      return seal(p,{request:{method:'GET',path:'/hr/v2/workers',query:{$top:take,$skip:safeOffset}},status:204,headers:{},body:null,next:null,terminal:true,retryClass:'NONE'});
    }
    if(fault==='async'){
      return seal(p,{request:{method:'GET',path:'/hr/v2/workers',headers:{Prefer:'respond-async'}},status:202,headers:{link:'/async/jobs/ns-123','retry-after':'2'},body:null,next:{poll:'/async/jobs/ns-123'},terminal:false,retryClass:'POLL'});
    }
    const workers=page(records,safeOffset,take).map(x=>({associateOID:x.associateOID,workerStatus:{statusCode:{codeValue:x.status==='ACTIVE'?'A':'T'}},workAssignments:[{primaryIndicator:true,itemID:x.employeeRef}]}));
    return seal(p,{
      request:{method:'GET',path:'/hr/v2/workers',query:{$top:take,$skip:safeOffset}},
      status:200,headers:{'content-type':'application/json'},body:{workers,_meta:{totalNumber:total}},
      next:{offset:safeOffset+workers.length,limit:take},terminal:false,retryClass:'NONE'
    });
  }

  if(providerId==='mulesoft-gateway'){
    if(fault==='transform-failure'){
      return seal(p,{request:{method:'POST',path:'/northstar/workers',headers:{'x-source-request':requestId}},status:400,headers:{'content-type':'application/json'},body:{error:'body_transformation_failed'},terminal:true,retryClass:'FIX_TRANSFORM'});
    }
    const source=page(records,0,Math.min(Number(limit)||10,50));
    const transformed=source.map(x=>({workerId:x.employeeRef,active:x.status==='ACTIVE',siteCode:x.site}));
    return seal(p,{
      request:{method:'POST',path:'/northstar/workers',headers:{'x-source-request':requestId,'x-policy':'northstar-transform-v1'},body:{records:source}},
      transformation:{inputDigest:digest(source),outputDigest:digest(transformed),policy:'northstar-transform-v1'},
      status:200,headers:{'content-type':'application/json','x-upstream':'vector-test'},body:{records:transformed},
      next:null,terminal:true,retryClass:'NONE'
    });
  }

  const take=Math.min(Math.max(1,Number(limit)||100),250);
  const rows=page(records,safeOffset,take);
  const filename='NORTHSTAR_WORKERS_'+String(safeOffset).padStart(6,'0')+'.csv';
  const checksum=digest(rows);
  if(fault==='partial-batch'){
    return seal(p,{request:{transport:'SFTP',filename:filename+'.partial'},status:422,headers:{},body:{checksum,complete:false},terminal:true,retryClass:'QUARANTINE'});
  }
  return seal(p,{request:{transport:'SFTP',filename,atomicRenameFrom:filename+'.tmp'},status:200,headers:{},body:{rows,checksum,complete:true},next:safeOffset+rows.length<total?{offset:safeOffset+rows.length,limit:take}:null,terminal:safeOffset+rows.length>=total,retryClass:'NONE'});
}

function seal(p,result){
  const core={
    recordType:'northstar-provider-emulation-receipt',
    provider:{id:p.id,name:p.name,category:p.category,sourceAuthority:p.sourceAuthority},
    simulated:true,
    certifiedByProvider:false,
    result,
    authority:{production:false,customerTenant:false,providerCredential:false},
    claimBoundary:'Provider emulator based on selected documented/public interface semantics. Not provider certification or a live provider connection.'
  };
  return Object.freeze({...core,receiptDigest:digest(core)});
}
