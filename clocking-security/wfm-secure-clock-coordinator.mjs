import crypto from 'node:crypto';

function hash(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function clone(x){return JSON.parse(JSON.stringify(x));}

/** Joins high-assurance employee presence to the verified-time kiosk model.
 * The kiosk never supplies an employee ID in this path; employee identity comes only from
 * the consumed server-side presence token. Outer receipts protect response-loss retries.
 */
export class SecureClockCoordinator {
  constructor({presence,kiosk}){this.presence=presence;this.kiosk=kiosk;this.receipts=new Map();}

  clock({deviceId,presenceToken,challengeId,eventId,sequence,type,capturedAt,serverNowMs}){
    const device=this.kiosk.devices.get(deviceId);
    if(!device||!device.active)throw Object.assign(new Error('Device is not active.'),{status:401});
    const key=`${deviceId}:${eventId}`;
    const digest=hash({presenceToken,challengeId:challengeId||null,eventId,sequence,type,capturedAt});
    const prior=this.receipts.get(key);
    if(prior){
      if(prior.digest!==digest)throw Object.assign(new Error('Secure clock event ID reused for different content.'),{status:409});
      return {...clone(prior.result),replayed:true};
    }

    const identity=this.presence.consumePresence({tenant:device.tenant,site:device.site,deviceId,presenceToken,nowMs:serverNowMs});
    const sync=this.kiosk.syncBatch({deviceId,events:[{eventId,sequence,employee:identity.employee,type,capturedAt,challengeId}],serverNowMs});
    const r=sync.results[0];
    if(!r||r.status==='rejected'){
      const e=Object.assign(new Error(r?.error||'Clock event rejected.'),{status:r?.code||409});
      e.clockResult=r; throw e;
    }
    const result={...r,identityAssurance:identity.assurance,employee:identity.employee,site:identity.site,deviceId};
    this.receipts.set(key,{digest,result:clone(result)});
    return {...result,replayed:false};
  }
}
