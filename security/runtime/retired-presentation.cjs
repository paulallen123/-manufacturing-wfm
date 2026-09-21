'use strict';
const retired = new Set(['factory-control-ui.js','factory-control-ui.css','value-cockpit-ui.js','value-cockpit-ui.css','review-ui.js','review-ui.css','ui-evolution.css','vector-shell.js']);
function serveRetiredPresentation(req,res){
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return false;}
  if(!retired.has(pathname.split('/').at(-1)))return false;
  res.writeHead(410,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:'This presentation asset has been retired. Reload Vector.');
  return true;
}
module.exports={serveRetiredPresentation};
