#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function cleanValue(raw='') {
  return String(raw).trim().replace(/^['"]|['"]$/g,'');
}

export function auditCircleCi(text) {
  const findings=[];
  const lines=String(text||'').split(/\r?\n/);
  let section=null;
  let sectionIndent=-1;

  for (let index=0; index<lines.length; index++) {
    const line=lines[index];
    const trimmed=line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent=(line.match(/^\s*/)?.[0].length)||0;

    if (section && indent<=sectionIndent && !/^(docker|machine):\s*$/.test(trimmed)) {
      section=null;
      sectionIndent=-1;
    }

    if (/^docker:\s*$/.test(trimmed)) {
      section='docker';
      sectionIndent=indent;
      continue;
    }
    if (/^machine:\s*$/.test(trimmed)) {
      section='machine';
      sectionIndent=indent;
      continue;
    }

    if (section==='docker') {
      const match=line.match(/^\s*-\s*image:\s*([^\s#]+)/);
      if (match) {
        const image=cleanValue(match[1]);
        if (!/@sha256:[0-9a-f]{64}$/i.test(image)) {
          findings.push({
            code:'CIRCLECI_DOCKER_IMAGE_NOT_DIGEST_PINNED',
            line:index+1,
            value:image
          });
        }
      }
    }

    if (section==='machine') {
      const match=line.match(/^\s*image:\s*([^\s#]+)/);
      if (match) {
        const image=cleanValue(match[1]);
        if (/:(?:current|edge|default|latest)$/i.test(image)) {
          findings.push({
            code:'CIRCLECI_MACHINE_IMAGE_MUTABLE_ALIAS',
            line:index+1,
            value:image
          });
        }
      }
    }
  }
  return findings;
}

export function auditGithubWorkflows(files) {
  const findings=[];
  for (const {file,text} of files) {
    const lines=String(text||'').split(/\r?\n/);
    lines.forEach((line,index)=>{
      const match=line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
      if (!match) return;
      const ref=cleanValue(match[1]);
      if (ref.startsWith('./')) return;
      if (!/@[0-9a-f]{40}$/i.test(ref)) {
        findings.push({
          code:'GITHUB_ACTION_NOT_COMMIT_PINNED',
          file,
          line:index+1,
          value:ref
        });
      }
    });
  }
  return findings;
}

function workflowFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out=[];
  for (const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const full=path.join(root,entry.name);
    if (entry.isDirectory()) out.push(...workflowFiles(full));
    else if (/\.ya?ml$/i.test(entry.name)) out.push({file:full,text:fs.readFileSync(full,'utf8')});
  }
  return out;
}

function selfTest() {
  const safe=`jobs:\n  test:\n    docker:\n      - image: cimg/node:22.23.2@sha256:${'a'.repeat(64)}\n  release:\n    machine:\n      image: ubuntu-2404:2026.05.1\n`;
  const unsafe=`jobs:\n  test:\n    docker:\n      - image: cimg/node:22.23.2\n  release:\n    machine:\n      image: ubuntu-2404:current\n`;
  const safeFindings=auditCircleCi(safe);
  if (safeFindings.length!==0) throw new Error('Safe CircleCI fixture was rejected: '+JSON.stringify(safeFindings));
  const unsafeFindings=auditCircleCi(unsafe);
  const codes=new Set(unsafeFindings.map(x=>x.code));
  if (!codes.has('CIRCLECI_DOCKER_IMAGE_NOT_DIGEST_PINNED') || !codes.has('CIRCLECI_MACHINE_IMAGE_MUTABLE_ALIAS')) {
    throw new Error('Unsafe CircleCI fixture did not fail closed: '+JSON.stringify(unsafeFindings));
  }
  const ghSafe=auditGithubWorkflows([{file:'safe.yml',text:'steps:\n  - uses: actions/checkout@'+('b'.repeat(40))+'\n  - uses: ./local-action\n'}]);
  if (ghSafe.length!==0) throw new Error('Safe GitHub fixture was rejected: '+JSON.stringify(ghSafe));
  const ghUnsafe=auditGithubWorkflows([{file:'unsafe.yml',text:'steps:\n  - uses: actions/checkout@v4\n'}]);
  if (!ghUnsafe.some(x=>x.code==='GITHUB_ACTION_NOT_COMMIT_PINNED')) throw new Error('Mutable GitHub Action fixture did not fail closed.');
  console.log('CI_SUPPLY_CHAIN_SELF_TEST=PASS');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const findings=[];
const circlePath=path.resolve('.circleci/config.yml');
if (fs.existsSync(circlePath)) findings.push(...auditCircleCi(fs.readFileSync(circlePath,'utf8')));
findings.push(...auditGithubWorkflows(workflowFiles(path.resolve('.github/workflows'))));

if (findings.length) {
  console.error('CI supply-chain admission refused mutable executor/action references:');
  for (const finding of findings) console.error(JSON.stringify(finding));
  process.exit(1);
}

console.log('CI_SUPPLY_CHAIN_POLICY=PASS');
