'use strict';
const allowed=new Set(['127.0.0.1','localhost','::1','[::1]']);
const validate=value=>{const u=new URL(typeof value==='string'?value:value.url);if(u.protocol!=='http:'||!allowed.has(u.hostname))throw Error('COMPOSITION_EXTERNAL_NETWORK_FORBIDDEN');};
const fetch=globalThis.fetch;globalThis.fetch=function(value,...args){validate(value);return fetch.call(this,value,...args);};
for(const name of ['node:http','node:https']){const api=require(name);for(const key of ['request','get']){const old=api[key];api[key]=function(value,...args){if(typeof value==='string'||value instanceof URL)validate(value.toString());else if(value&&typeof value==='object'){const hostname=value.hostname||value.host||'localhost';if(name==='node:https'||!allowed.has(hostname))throw Error('COMPOSITION_EXTERNAL_NETWORK_FORBIDDEN');}else throw Error('COMPOSITION_NETWORK_TARGET_REQUIRED');return old.call(this,value,...args);};}}
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const opts=args[0];let hostname;if(opts&&typeof opts==='object'){if(opts.path)throw Error('COMPOSITION_NETWORK_PIPE_FORBIDDEN');hostname=opts.host||opts.hostname||'localhost';}else hostname=typeof args[1]==='string'?args[1]:'localhost';if(!allowed.has(hostname))throw Error('COMPOSITION_EXTERNAL_NETWORK_FORBIDDEN');return connect.apply(this,args);};
require('node:tls').connect=()=>{throw Error('COMPOSITION_EXTERNAL_NETWORK_FORBIDDEN');};
