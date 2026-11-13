'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const shell=fs.readFileSync(path.join(__dirname,'vector-shell.js'),'utf8');
const block=shell.split('// VECTOR_HELP_DIALOG_START')[1].split('// VECTOR_HELP_DIALOG_END')[0];
function harness(fetch){
 let focused=null,botClicks=0;
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.events={};this.attributes={};this.style={};this.value='';this.textContent='';this.isConnected=true;}
  appendChild(n){n.parent=this;this.children.push(n);return n;}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,v){this.events[k]=v;}querySelector(tag){return this.children.flatMap(x=>[x,...x.all()]).find(x=>x.tagName===tag);}all(){return this.children.flatMap(x=>[x,...x.all()]);}
  replaceChildren(){this.children=[];}remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(x=>x!==this);}focus(){focused=this;}showModal(){this.open=true;}close(){this.open=false;this.events.close?.();}click(){this.events.click?.();}
 }
 const body=new Element('body'),trigger=new Element('button'),bot=new Element('button');bot.id='wfm-bot-launch';bot.events.click=()=>botClicks++;body.appendChild(bot);
 const document={body,activeElement:trigger,createElement:tag=>new Element(tag),getElementById:id=>body.all().find(x=>x.id===id)};
 const context=vm.createContext({document,fetch,AbortController,setTimeout,clearTimeout,go:()=>{throw Error('unexpected route');}});vm.runInContext('// VECTOR_HELP_DIALOG_START'+block,context);context.openVectorHelp();
 const dialog=document.getElementById('vector-help-dialog'),question=dialog.querySelector('textarea'),form=dialog.querySelector('form'),status=dialog.children.find(x=>x.attributes.role==='status');
 return {document,dialog,question,form,status,submit:()=>form.events.submit({preventDefault(){}}),trigger,focused:()=>focused,botClicks:()=>botClicks,context};
}
test('Help toolbar opens a named modal, focuses question and retains separate Operations Bot',()=>{
 assert.match(shell,/data-vector-help aria-label="Help" aria-haspopup="dialog"/);assert.match(shell,/closest\('\[data-vector-help\]'\)\)\{openVectorHelp\(\);return;/);
 const h=harness(async()=>{});assert.equal(h.dialog.open,true);assert.equal(h.dialog.attributes['aria-labelledby'],'vector-help-title');assert.equal(h.focused(),h.question);assert.equal(h.question.maxLength,4000);
 h.dialog.events.cancel();h.dialog.close();assert.equal(h.focused(),h.trigger);
 h.context.openVectorHelp();h.document.getElementById('vector-help-dialog').children.find(x=>x.textContent==='Open Operations Bot').click();assert.equal(h.botClicks(),1);
});
test('server content renders as text; same-origin minimal request, no identity claims',async()=>{
 let sent;const html='<img src=x onerror=alert(1)>';
 const h=harness(async(url,options)=>{sent={url,options};return {ok:true,status:200,json:async()=>({status:'answered',answer:html,actionAuthority:false,sources:[html]})};});
 h.question.value='payroll review';await h.submit();assert.equal(sent.url,'/api/support/self-help');assert.equal(sent.options.credentials,'same-origin');assert.deepEqual(JSON.parse(sent.options.body),{text:'payroll review'});
 assert.equal(h.dialog.children.some(x=>x.textContent===html),true);assert.equal(h.dialog.querySelector('ul').children[0].textContent,'Documented product guidance');assert.equal(h.dialog.all().some(x=>x.tagName==='img'),false);assert.equal(h.form.attributes['aria-busy'],undefined);
 assert.doesNotMatch(block,/innerHTML|insertAdjacentHTML/);
});
test('authentication failure clears previous response; unknown and network failures stay honest',async()=>{
 let status=200,mode='answer';const h=harness(async()=>{if(mode==='error')throw Error('offline');return {ok:status===200,status,json:async()=>mode==='answer'?{status:'answered',answer:'Guidance',sources:[],actionAuthority:false}:{status:'abstain'}};});
 h.question.value='payroll review';await h.submit();status=401;await h.submit();assert.match(h.status.textContent,/Sign in again/);assert.equal(h.dialog.children.some(x=>x.textContent==='Guidance'),false);
 status=403;await h.submit();assert.match(h.status.textContent,/Sign in again/);status=200;mode='unknown';await h.submit();assert.match(h.status.textContent,/No verified answer/);mode='error';await h.submit();assert.match(h.status.textContent,/temporarily unavailable/);
});
test('closing aborts in-flight request; late response cannot overwrite or create actions',async()=>{
 let resolve,signal,calls=0;const h=harness(async(_,options)=>{calls++;signal=options.signal;return new Promise(r=>resolve=r);});h.question.value='payroll review';const first=h.submit();await h.submit();assert.equal(calls,1);h.dialog.close();assert.equal(signal.aborted,true);
 resolve({ok:true,status:200,json:async()=>({status:'answered',answer:'stale response',actionAuthority:false})});await first;assert.equal(h.dialog.children.some(x=>x.textContent==='stale response'),false);
});
