'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'candidate/.github/workflows/autonomous-integration-fabric.yml');
const pre=fs.readFileSync(path.join(__dirname,'preimages/.github/workflows/autonomous-integration-fabric.yml'),'utf8');
if(fs.readFileSync(file,'utf8')!==pre)throw Error('Expected unchanged exact frozen preimage');
fs.copyFileSync(path.join(__dirname,'candidate/.github/workflows/autonomous-integration-fabric.test.cjs'),path.join(__dirname,'evidence/red-body.test.cjs'));
const eol=pre.includes('\r\n')?'\r\n':'\n';
const lines=pre.split(eol),out=[];let job=null,bindings=0,bodies=0;
for(const line of lines){
  if(line==='  local-proof:')job='local';if(line==='  hosted-railway-proof:')job='hosted';
  if(line.includes('/sync-validate')){
    const marker='--data "{\\"connectionId\\":\\"$connection_id\\",\\"records\\":';
    if(!line.includes(marker))throw Error('Unexpected sync body');
    out.push(line.replace(marker,'--data "{\\"tenant\\":$tenant_json,\\"connectionId\\":\\"$connection_id\\",\\"records\\":'));bodies++;continue;
  }
  out.push(line);
  if(line.trim()==='test -n "$cookie"'){
    if(!job)throw Error('No job');
    const document=job==='local'?'/tmp/bootstrap.json':'/tmp/hosted-bootstrap.json';
    const request=job==='local'?
      'curl -sSf             -H \'Host: staging.integration.test\'             -H \'X-Forwarded-Proto: https\'             -H "Cookie: $cookie"             http://127.0.0.1:38119/api/bootstrap >'+document:
      'curl -sSf -H "Cookie: $cookie" "$WFM_BASE_URL/api/bootstrap" >'+document;
    const expression="const d=require('"+document+"');const a=d&&d.actor;const t=a&&a.tenant;if(!a||a.email!=='manager@northstar.example'||a.role!=='manager'||typeof t!=='string'||!t||t!==t.trim()||t.length>120||Array.from(t).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))process.exit(2);process.stdout.write(JSON.stringify(t))";
    out.push('', '          # Bind to the existing authenticated session; no fixture tenant default.',
      '          '+request,'          tenant_json="$(node -e "'+expression+'")"','          test -n "$tenant_json"');bindings++;
  }
}
if(bindings!==2||bodies!==2)throw Error('Expected exactly two bounded repairs');
fs.writeFileSync(file,out.join(eol));console.log(JSON.stringify({bindings,bodies,eol:eol==='\r\n'?'CRLF':'LF'}));
