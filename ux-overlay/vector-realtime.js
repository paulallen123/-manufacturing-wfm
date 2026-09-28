(function(){
'use strict';
if(window.VectorRealtime)return;
const MARKER='VECTOR_REALTIME_V1';
let source=null,retryTimer=null,attempt=0,fallbackTimer=null,stopped=false;
function emit(detail){
  try{window.dispatchEvent(new CustomEvent('vector:realtime',{detail}));}catch{}
  try{window.VectorDemandDecisionIntelligence?.refresh?.();}catch{}
}
function fallback(){
  if(fallbackTimer)return;
  fallbackTimer=setInterval(()=>emit({topic:'fallback.poll',authority:'refetch-only'}),30000);
}
function schedule(){
  if(stopped||retryTimer)return;
  const delay=Math.min(30000,1000*Math.pow(2,Math.min(attempt++,5)));
  retryTimer=setTimeout(()=>{retryTimer=null;connect();},delay);
}
function connect(){
  if(stopped||source)return;
  if(!('EventSource' in window)){fallback();return;}
  try{
    source=new EventSource('/api/realtime/stream',{withCredentials:true});
    source.onopen=()=>{attempt=0;};
    source.addEventListener('vector-change',event=>{
      let detail={topic:'unknown',authority:'refetch-only'};
      try{detail={...JSON.parse(event.data),authority:'refetch-only'};}catch{}
      emit(detail);
    });
    source.onerror=()=>{
      try{source.close();}catch{}
      source=null;
      schedule();
    };
  }catch{source=null;schedule();}
}
function stop(){
  stopped=true;
  if(retryTimer)clearTimeout(retryTimer);
  if(fallbackTimer)clearInterval(fallbackTimer);
  retryTimer=fallbackTimer=null;
  try{source?.close();}catch{}
  source=null;
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!source&&!stopped)connect();});
window.addEventListener('beforeunload',stop,{once:true});
setTimeout(connect,750);
window.VectorRealtime={marker:MARKER,reconnect(){stopped=false;try{source?.close();}catch{}source=null;connect();},stop};
})();
