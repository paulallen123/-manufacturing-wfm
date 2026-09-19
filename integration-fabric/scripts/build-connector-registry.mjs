import fs from 'node:fs';
import {buildConnectorRegistry} from '../runtime/connector-registry.mjs';

const registry=buildConnectorRegistry();
fs.mkdirSync('integration-fabric/reports',{recursive:true});
fs.writeFileSync('integration-fabric/reports/connector-registry.json',JSON.stringify(registry,null,2)+'\n');

console.log(JSON.stringify({
  ok:true,
  connectors:registry.connectors.length,
  withoutAdapters:registry.connectors.filter(x=>x.adapters.length===0).length,
  edgeRequired:registry.connectors.filter(x=>x.security.customerEdgeRequired).length,
  readOnlyDefault:registry.connectors.filter(x=>x.security.readOnlyDefault&&!x.security.writeEnabled).length
},null,2));
