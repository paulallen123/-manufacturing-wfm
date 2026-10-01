'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');

function generatedPreload(){
 const source=readFileSync(resolve(__dirname,'full-http-employee-journey.test.cjs'),'utf8');
 const start="writeFileSync(mockProvider,`",from=source.indexOf(start);
 assert.notEqual(from,-1,'mock provider template start must remain reviewable');
 const bodyStart=from+start.length,end=source.indexOf('`);',bodyStart);
 assert.notEqual(end,-1,'mock provider template end must remain reviewable');
 const template=source.slice(bodyStart,end);
 assert.equal(template.includes('${'),false,'mock preload must not depend on outer template interpolation');
 return Function(`return \`${template}\`;`)();
}

test('actual generated Staffology child preload compiles and retains fail-closed loopback fencing',()=>{
 const generated=generatedPreload();
 assert.doesNotThrow(()=>new vm.Script(generated,{filename:'generated-mock-staffology.cjs'}));
 assert.match(generated,/u\.protocol==='http:'&&\['127\.0\.0\.1','localhost'\]\.includes\(u\.hostname\)/);
 assert.match(generated,/throw Error\('UNEXPECTED_EXTERNAL_ORIGIN'\)/);
});
