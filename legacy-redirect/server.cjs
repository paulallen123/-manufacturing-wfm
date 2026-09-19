'use strict';
// redirect generation 2: force Railway source refresh for retired public UI shells
const http=require('node:http');
const target=String(process.env.VECTOR_CANONICAL_URL||'https://wfm-one-day-enterprise-v1-production.up.railway.app').replace(/\/$/,'');
const marker='VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';
http.createServer((req,res)=>{
  const url=String(req.url||'/');
  const path=url.split('?')[0];
  if(path==='/api/health'){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-WFM-UI':marker});
    return res.end(JSON.stringify({ok:true,ui:marker,redirect:target}));
  }
  res.writeHead(307,{'Location':target+url,'Cache-Control':'no-store','X-WFM-UI':marker});
  res.end();
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('LEGACY_UI_REDIRECT_ACTIVE '+target));
