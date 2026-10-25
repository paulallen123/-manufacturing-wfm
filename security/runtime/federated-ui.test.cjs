'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('./federated-ui.js'),'utf8');
async function run({providers=[],fail=false,search='',recovery=false}={}) {
  const nodes=Object.fromEntries(['federated-sign-in','google-sign-in','apple-sign-in'].map(id=>[id,{hidden:true,addEventListener(_,fn){this.click=fn;}}]));
  if(recovery)nodes['owner-recovery-code']={};
  const navigations=[];let requests=0;
  vm.runInNewContext(source,{URLSearchParams,document:{getElementById:id=>nodes[id]},location:{search,hash:'',assign:v=>navigations.push(v)},fetch:async()=>{requests++;return{ok:!fail,json:async()=>({providers})};}});
  await new Promise(resolve=>setImmediate(resolve));return{nodes,navigations,requests};
}
test('only configured providers become visible and redirect to fixed same-origin routes',async()=>{const f=await run({providers:['google','evil']});assert.equal(f.nodes['google-sign-in'].hidden,false);assert.equal(f.nodes['apple-sign-in'].hidden,true);f.nodes['google-sign-in'].click();assert.deepEqual(f.navigations,['/api/auth/federated/google/start']);});
test('unavailable configuration retains passkey-only entry',async()=>{const f=await run({fail:true});assert.equal(f.nodes['federated-sign-in'].hidden,true);});
test('recovery and invitations never start federation',async()=>{for(const options of [{recovery:true},{search:'?implementation_invite=private-fixture'}]){const f=await run(options);assert.equal(f.requests,0);assert.equal(f.nodes['federated-sign-in'].hidden,true);}});
