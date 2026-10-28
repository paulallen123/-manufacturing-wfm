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

test('root heldout: late JSON after close is discarded and action-authorized payload is never rendered',async()=>{
 let resolveJson;const h=harness(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{resolveJson=resolve;})}));h.question.value='payroll review';const pending=h.submit();for(let i=0;i<10&&!resolveJson;i++)await Promise.resolve();assert.ok(resolveJson);h.dialog.close();resolveJson({status:'answered',answer:'stale private response',actionAuthority:false});await pending;assert.equal(h.dialog.children.some(x=>x.textContent==='stale private response'),false);
 const fresh=harness(async()=>({ok:true,status:200,json:async()=>({status:'answered',answer:'Perform payroll now',actionAuthority:true,sources:[]})}));fresh.question.value='payroll review';await fresh.submit();assert.match(fresh.status.textContent,/No verified answer/);assert.equal(fresh.dialog.children.some(x=>x.textContent==='Perform payroll now'),false);
});
