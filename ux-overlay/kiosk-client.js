'use strict';
const DB='wfm-kiosk-v1',STORE='state';let db;
const $=id=>document.getElementById(id),nowIso=()=>new Date().toISOString();
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function read(key){return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function write(key,value){return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).put(value,key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});}
async function config(){return await read('config')||null} async function queue(){return await read('queue')||[]}
// Keep queue identity and sequence in one IndexedDB transaction. The change
// callback is synchronous so no transaction is held open across network work.
function changeLocal(change){return new Promise((resolve,reject)=>{
 const t=db.transaction(STORE,'readwrite'),store=t.objectStore(STORE);let c,q,loaded=0,value,failure;
 const ready=()=>{if(++loaded!==2)return;try{if(q!==undefined&&!Array.isArray(q))throw Error('Stored clock queue is invalid. Keep this device for review.');const next=change(c||null,q||[]);if(Object.prototype.hasOwnProperty.call(next,'config'))store.put(next.config,'config');if(Object.prototype.hasOwnProperty.call(next,'queue'))store.put(next.queue,'queue');value=next.value;}catch(e){failure=e;t.abort();}};
 const cr=store.get('config'),qr=store.get('queue');cr.onsuccess=()=>{c=cr.result;ready();};qr.onsuccess=()=>{q=qr.result;ready();};
 t.oncomplete=()=>resolve(value);t.onerror=t.onabort=()=>reject(failure||t.error||Error('Local clock storage did not commit.'));
});}

function uid(){return 'evt-'+crypto.randomUUID().replaceAll('-','')}
async function render(){const c=await config(),q=await queue();$('setup').hidden=!!c;$('clock').hidden=!c;$('queued').textContent=q.length;if(c)$('deviceName').textContent=c.name||c.id;const online=navigator.onLine;$('network').textContent=online?'Online · server sync available':'Offline · events will queue safely';$('network').className='status '+(online?'online':'offline');$('queueDetail').textContent=q.length?'Stored locally in order. The oldest event must be acknowledged before later events are removed.':'Nothing is removed until the server acknowledges it.';}
async function enqueue(type){
 const employee=$('employee').value.trim();if(!employee)throw Error('Scan or enter an employee ID.');const eventId=uid(),capturedAt=nowIso();
 await changeLocal((c,q)=>{if(!c)throw Error('Register this tablet first.');const seq=c.nextSequence??1;if(!Number.isSafeInteger(seq)||seq<1||seq>=Number.MAX_SAFE_INTEGER)throw Error('Device sequence is invalid. Keep queued events for review.');const event={eventId,sequence:seq,employee,type,capturedAt,clockOffsetMs:c.clockOffsetMs||0};return{queue:[...q,event],config:{...c,nextSequence:seq+1}};});
 $('result').className='result queued';$('result').textContent='Recorded safely on this tablet. Sync is pending.';await render();if(navigator.onLine)await sync();
}
async function sync(){
 const {c,q}=await changeLocal((c,q)=>({value:{c,q}}));if(!c||!q.length)return render();
 try{const r=await fetch('/api/kiosk/sync',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Device '+c.secret,'X-Device-Id':c.id},body:JSON.stringify({events:q})});const b=await r.json();if(!r.ok)throw Error(b.error||'Sync rejected.');const accepted=new Set((b.results||[]).filter(x=>x.status==='accepted').map(x=>x.eventId)),submitted=new Map(q.map(x=>[x.eventId,JSON.stringify(x)]));
  const remaining=await changeLocal((current,events)=>{if(!current||current.id!==c.id||current.secret!==c.secret)return{value:events};const remaining=events.filter(x=>!accepted.has(x.eventId)||submitted.get(x.eventId)!==JSON.stringify(x));return{queue:remaining,value:remaining};});
  $('result').className='result '+(remaining.length?'queued':'synced');$('result').textContent=remaining.length?(b.results.find(x=>x.status==='held')?.error||'Some events remain queued for review.'):'Synced to the server. Attendance still follows the normal manager/payroll review process.';
 }catch(e){$('result').className='result queued';$('result').textContent='Still stored safely on this tablet. Sync will retry: '+e.message;}await render();
}
async function init(){db=await openDb();await render();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('/kiosk-sw.js').catch(()=>{});$('saveDevice').onclick=async()=>{const id=$('deviceId').value.trim(),secret=$('deviceSecret').value.trim();if(!id||secret.length<32){$('result').textContent='Enter the complete device ID and secret.';return;}await write('config',{id,secret,name:id,nextSequence:1,clockOffsetMs:0});$('deviceSecret').value='';await render();};$('forget').onclick=async()=>{await write('config',null);await render();};document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>enqueue(b.dataset.kind).catch(e=>{ $('result').className='result error';$('result').textContent=e.message;}));$('sync').onclick=sync;window.addEventListener('online',sync);window.addEventListener('offline',render);setInterval(()=>{if(navigator.onLine)sync()},30000);}
init().catch(e=>{document.body.innerHTML='<main class="kiosk"><section class="card"><h1>Clock unavailable</h1><p>'+String(e.message).replace(/[<>&]/g,'')+'</p></section></main>';});
