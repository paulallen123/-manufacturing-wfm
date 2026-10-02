'use strict';
const {types}=require('node:util');
// Read descriptors only after rejecting proxies. Never invoke input getters,
// serializers, inherited methods or caller-overridden array methods.
function inertJsonCopy(value,label='input',ancestors=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error(label+' requires finite JSON numbers');return value;}
  if(typeof value!=='object'||types.isProxy(value))throw Error(label+' requires inert JSON data');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(prototype!==(array?Array.prototype:Object.prototype)&&!(prototype===null&&!array))throw Error(label+' requires plain inert JSON objects');
  if(ancestors.has(value))throw Error(label+' has a cyclic JSON value');
  ancestors.add(value);
  try{
    const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
    const copy=array?[]:Object.create(null);
    for(const key of keys){
      if(typeof key!=='string')throw Error(label+' requires JSON string keys');
      const descriptor=descriptors[key];
      if(!Object.hasOwn(descriptor,'value'))throw Error(label+' cannot contain accessors');
      if(array&&key==='length')continue;
      if(!descriptor.enumerable)throw Error(label+' cannot contain hidden non-JSON properties');
      if(array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=descriptors.length.value))throw Error(label+' cannot override array methods or properties');
      Object.defineProperty(copy,key,{value:inertJsonCopy(descriptor.value,label+'.'+key,ancestors),writable:true,enumerable:true,configurable:true});
    }
    if(array){for(let i=0;i<descriptors.length.value;i++)if(!Object.hasOwn(descriptors,String(i)))throw Error(label+' cannot contain sparse JSON arrays');}
    return copy;
  }finally{ancestors.delete(value);}
}

module.exports=Object.freeze({inertJsonCopy});
