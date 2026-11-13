'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'vector-shell.js'),'utf8'),start=source.indexOf('function syncSettingsMenu'),end=source.indexOf('function apply()',start);

class Element{constructor(){this.children=[];this.dataset={};this.className='';this.attributes={};this.scrolled=false;}setAttribute(key,value){this.attributes[key]=value;}set innerHTML(value){this.html=value;}querySelector(selector){return selector.includes('vector-settings')?this.children.find(child=>child.className.includes('vector-settings'))||null:null;}prepend(child){child.parentElement=this;this.children.unshift(child);}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}scrollIntoView(){this.scrolled=true;}}
test('Settings & more survives an authoritative content rerender until explicitly closed and hides unavailable routes',()=>{assert.ok(start>0&&end>start);let content=new Element();const buttons=[{dataset:{page:'company'},textContent:'Organisation'},{dataset:{page:'integrations'},textContent:'Integrations'},{dataset:{page:'forbidden'},textContent:'Forbidden control'}],sandbox={state:{settingsOpen:false},NAV:[],sourceButtons:()=>buttons,available:route=>route!=='forbidden',esc:String,text:node=>node.textContent,document:{querySelector:()=>content,createElement:()=>new Element()},api:null};vm.runInNewContext(source.slice(start,end)+';api={syncSettingsMenu,settingsMenu};',sandbox);sandbox.api.settingsMenu();assert.equal(sandbox.state.settingsOpen,true);assert.equal(content.children.length,1);assert.equal(content.children[0].dataset.vectorSettingsPanel,'1');assert.match(content.children[0].html,/Organisation/);assert.doesNotMatch(content.children[0].html,/Forbidden control/);content=new Element();sandbox.api.syncSettingsMenu(content);assert.equal(content.children.length,1,'persistent state must recreate the panel after content replacement');sandbox.api.settingsMenu();assert.equal(sandbox.state.settingsOpen,false);assert.equal(content.children.length,0);});


function keyboardHarness(){
 const listeners=new Map(),focusEvents=[],classes=new Set();
 let content;
 const document={activeElement:null,documentElement:{},body:{classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},toggle(name){classes.has(name)?classes.delete(name):classes.add(name);},contains(name){return classes.has(name);}},dataset:{}},
  addEventListener(type,listener){const registered=listeners.get(type)||[];registered.push(listener);listeners.set(type,registered);},
  querySelector(selector){return selector==='.content'?content:null;},querySelectorAll(){return [];},getElementById(){return null;},
  createElement(){return new Node();}};
 class Node{
  constructor(kind='section',parent=null){this.kind=kind;this.parentElement=parent;this.children=[];this.dataset={};this.className='';this.attributes={};this.disabled=false;this.detached=false;this.scrolled=false;}
  setAttribute(key,value){this.attributes[key]=value;}
  set innerHTML(value){this.html=value;if(value.includes('data-vector-settings>Close')){const close=new Node('close',this);close.dataset.vectorSettings='';this.children=[close];}}
  get isConnected(){return !this.detached&&(!this.parentElement||this.parentElement.isConnected);}
  prepend(child){child.parentElement=this;this.children.unshift(child);}
  remove(){this.detached=true;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);if(this.contains(document.activeElement))document.activeElement=null;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  querySelector(selector){return selector.includes('.vector-settings')?this.children.find(child=>child.className.includes('vector-settings'))||null:selector==='[data-vector-settings]'?this.children.find(child=>Object.hasOwn(child.dataset,'vectorSettings'))||null:null;}
  closest(selector){if(selector==='[data-vector-settings]'&&Object.hasOwn(this.dataset,'vectorSettings'))return this;if(selector==='[data-vector-settings-panel]'&&Object.hasOwn(this.dataset,'vectorSettingsPanel'))return this;return this.parentElement?.closest(selector)||null;}
  focus(){document.activeElement=this;focusEvents.push(this);}
  scrollIntoView(){this.scrolled=true;}
 }
 content=new Node();
 const opener=new Node('opener');opener.dataset.vectorSettings='';
 const outside=new Node('outside');
 const sandbox={document,window:{addEventListener(){},location:{href:'https://example.test/'}},ui:{page:'overview'},me:()=>({}),isEmployee:()=>false,
  MutationObserver:class{observe(){}disconnect(){}},setTimeout(){return 0;},clearTimeout(){},queueMicrotask(){},URL,console};
 const instrumented=source.replace('window.VectorWorkforceOperations={marker:MARKER','window.VectorWorkforceOperations={syncSettingsMenu,state,marker:MARKER');vm.createContext(sandbox);vm.runInContext(instrumented,sandbox,{filename:'vector-shell.js'});
 function dispatch(type,target,key){let prevented=false;const event={target,key,preventDefault(){prevented=true;}};for(const listener of listeners.get(type)||[])listener(event);return prevented;}
 return {document,opener,outside,focusEvents,dispatch,panel:()=>content.querySelector('.vector-settings'),replaceContent(){content.detached=true;content=new Node();},expose(){return sandbox.window.VectorWorkforceOperations;},content:()=>content};
}

test('keyboard Settings open focuses Close and Close returns to the same opener',()=>{
 const h=keyboardHarness();h.opener.focus();h.dispatch('click',h.opener);
 const close=h.panel().querySelector('[data-vector-settings]');assert.equal(h.document.activeElement,close,'opening Settings must move focus into the newly inserted controls');
 h.dispatch('click',close);assert.equal(h.panel(),null);assert.equal(h.document.activeElement,h.opener,'closing Settings must restore the original opener');
});

test('Escape inside open Settings closes and restores focus without consuming Escape elsewhere',()=>{
 const h=keyboardHarness();h.opener.focus();h.dispatch('click',h.opener);const close=h.panel().querySelector('[data-vector-settings]');close.focus();
 assert.equal(h.dispatch('keydown',close,'Escape'),true);assert.equal(h.panel(),null);assert.equal(h.document.activeElement,h.opener);
 h.dispatch('click',h.opener);h.outside.focus();assert.equal(h.dispatch('keydown',h.outside,'Escape'),false);assert.ok(h.panel(),'Escape outside Settings must leave the panel open');assert.equal(h.document.activeElement,h.outside);
});

test('Settings does not restore focus to a removed or disabled opener',()=>{
 for(const unavailable of ['detached','disabled']){const h=keyboardHarness();h.opener.focus();h.dispatch('click',h.opener);const close=h.panel().querySelector('[data-vector-settings]');close.focus();h.opener[unavailable]=true;
  h.dispatch('click',close);assert.equal(h.panel(),null);assert.notEqual(h.document.activeElement,h.opener,unavailable+' opener cannot receive focus');}
});

test('Settings background synchronization retains focused controls and does not steal outside focus',()=>{
 const h=keyboardHarness(),api=h.expose();h.opener.focus();h.dispatch('click',h.opener);const panel=h.panel(),close=panel.querySelector('[data-vector-settings]');close.focus();
 const before=h.focusEvents.length;api.syncSettingsMenu(h.content());assert.equal(h.panel(),panel);assert.equal(h.document.activeElement,close);assert.equal(h.focusEvents.length,before);
 h.outside.focus();h.replaceContent();const outsideBefore=h.focusEvents.length;api.syncSettingsMenu(h.content());assert.ok(h.panel());assert.equal(h.document.activeElement,h.outside);assert.equal(h.focusEvents.length,outsideBefore);
});


test('Escape in Settings preserves dismissal of an open mobile menu',()=>{
 const h=keyboardHarness();h.opener.focus();h.dispatch('click',h.opener);h.document.body.classList.add('vector-menu-open');
 const close=h.panel().querySelector('[data-vector-settings]');assert.equal(h.dispatch('keydown',close,'Escape'),true);
 assert.equal(h.panel(),null);assert.equal(h.document.body.classList.contains('vector-menu-open'),false);assert.equal(h.document.activeElement,h.opener);
});
