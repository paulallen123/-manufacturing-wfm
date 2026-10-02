'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inertJsonCopy}=require('./inert-finite-json.cjs');
test('finite JSON is copied without aliasing, with special property names preserved as data',()=>{
 const value=JSON.parse('{"__proto__":{"safe":true},"values":[null,false,"x",0,-2,1e300]}');
 const result=inertJsonCopy(value);assert.equal(JSON.stringify(result),JSON.stringify(value));
 assert.equal(Object.getPrototypeOf(result),null);value.__proto__.safe=false;value.values[1]=true;
 assert.equal(result.__proto__.safe,true);assert.equal(result.values[1],false);
});
test('null-prototype JSON objects and repeated noncyclic references are finite inert data',()=>{
 const leaf=Object.assign(Object.create(null),{value:2}),result=inertJsonCopy({a:leaf,b:leaf});
 assert.equal(result.a.value,2);assert.notEqual(result.a,result.b);
});
for(const shape of ['accessor','proxy','revokedProxy','serializer','arrayMethod','arrayAccessor','arraySubclass','objectSubclass'])test('reject '+shape+' without executing caller code',()=>{
 let calls=0,value={ok:1};
 if(shape==='accessor')Object.defineProperty(value,'x',{get(){calls++;return 2;}});
 if(shape==='proxy')value=new Proxy(value,{getPrototypeOf(){calls++;return Object.prototype;},ownKeys(){calls++;return ['ok'];},get(){calls++;return 1;}});
 if(shape==='revokedProxy'){const p=Proxy.revocable(value,{});p.revoke();value=p.proxy;}
 if(shape==='serializer')value.toJSON=()=>{calls++;return {};};
 if(shape==='arrayMethod'){value=[1];value.map=()=>{calls++;return [];};}
 if(shape==='arrayAccessor'){value=[1];Object.defineProperty(value,'0',{get(){calls++;return 1;}});}
 if(shape==='arraySubclass'){value=[1];Object.setPrototypeOf(value,{get map(){calls++;return Array.prototype.map;}});}
 if(shape==='objectSubclass'){value=Object.create({get toJSON(){calls++;return()=>({});}});value.ok=1;}
 assert.throws(()=>inertJsonCopy(value));assert.equal(calls,0);
});
test('reject every non-JSON primitive, hidden and symbol property, cycle and sparse array',()=>{
 const cycle={};cycle.self=cycle;const hidden={};Object.defineProperty(hidden,'x',{value:1});
 const symbol={[Symbol('x')]:1},sparse=[];sparse.length=2;
 for(const value of [undefined,()=>1,1n,Symbol('x'),NaN,Infinity,-Infinity,{nested:undefined},hidden,symbol,cycle,sparse])assert.throws(()=>inertJsonCopy(value));
});
