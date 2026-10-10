import http from 'node:http';
import {handle} from './gusto-webhook-receiver.mjs';

// This replaces the former data-URL NODE_OPTIONS receiver with reviewed source.
// It uses the existing subscription; startup never creates provider resources.
const createServer=http.createServer;
http.createServer=function(...args) {
  const index=args.findIndex(value=>typeof value==='function');
  if(index<0) return createServer.apply(this,args);
  const listener=args[index];
  args[index]=async function(req,res) {
    if(await handle(req,res)) return;
    return listener.call(this,req,res);
  };
  return createServer.apply(this,args);
};
console.log('VECTOR_GUSTO_WEBHOOK_RECEIVER=VERSIONED_VERIFIED_TOKENS_ONLY');
