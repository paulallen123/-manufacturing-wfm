import fs from 'node:fs';
import assert from 'node:assert/strict';

const catalog=JSON.parse(fs.readFileSync(new URL('../systems.json',import.meta.url),'utf8'));
const protocols=JSON.parse(fs.readFileSync(new URL('../protocol-profiles.json',import.meta.url),'utf8'));
const matches=new Set(protocols.profiles.flatMap(p=>p.matches));

const p0=catalog.systems.filter(x=>x.priority==='P0');
const uncovered=p0.filter(x=>!x.protocols.some(p=>matches.has(p)));
assert.deepEqual(uncovered.map(x=>x.id),[], 'Every P0 system must map to at least one reusable protocol/vendor profile.');

for(const s of catalog.systems){
  assert.equal(s.writeEnabled,false,'Connector writes must remain disabled by default: '+s.id);
  if(s.testLevel==='tenant-authenticated'||s.testLevel==='read-roundtrip-proven'||s.testLevel==='write-roundtrip-proven'||s.testLevel==='production-certified'){
    assert.ok(s.evidenceRef,'High-confidence evidence requires evidenceRef: '+s.id);
  }
}

const ipaas=['mulesoft-anypoint','boomi','workato','sap-integration-suite','azure-logic-apps-power-automate','oracle-integration-cloud'];
for(const id of ipaas) assert.ok(catalog.systems.some(x=>x.id===id),'iPaaS target missing: '+id);

console.log(JSON.stringify({ok:true,p0:p0.length,profiles:protocols.profiles.length,uncoveredP0:uncovered.length,ipaasTargets:ipaas.length},null,2));
