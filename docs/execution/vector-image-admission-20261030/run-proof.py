#!/usr/bin/env python3
"""Reproduce Docker admission commands in copied declared-module layouts; no image claim."""
import argparse, hashlib, json, os, re, shutil, subprocess
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--candidate', type=Path, required=True)
p.add_argument('--baseline', type=Path, required=True)
p.add_argument('--node', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a=p.parse_args()
a.candidate=a.candidate.resolve(); a.baseline=a.baseline.resolve(); a.out=a.out.resolve(); a.node=a.node.resolve()
a.out.mkdir(parents=True, exist_ok=True)
def digest(p):
 b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest(),'bytes':len(b)}
def run(name, root, files, installed=None, expect=0, timeout=60):
 env=dict(os.environ)
 env.pop('VECTOR_IMAGE_ADMISSION_ROOT',None)
 if installed:env['VECTOR_IMAGE_ADMISSION_ROOT']=str(installed)
 cmd=[str(a.node),'--test','--test-concurrency=1',*map(str,files)]
 proc=subprocess.run(cmd,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
 log=a.out/(name+'.tap');log.write_bytes(proc.stdout)
 text=proc.stdout.decode(errors='replace')
 counts={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|skipped) (\d+)$',text,re.M)}
 receipt={'name':name,'cwd':str(root),'argv':cmd,'installedRoot':str(installed) if installed else None,'exit':proc.returncode,'expectedExit':expect,'counts':counts,'tap':log.name,**digest(log)}
 if proc.returncode!=expect:raise RuntimeError(json.dumps(receipt))
 if expect==0 and (counts.get('fail')!=0 or counts.get('skipped')!=0):raise RuntimeError(json.dumps(receipt))
 return receipt
# Copy only the production files in the Dockerfile's explicit flat destination
# declarations; no source-tree symlinks or duplicate modules accompany the fixtures.
def materialize(label, source):
 root=a.out/label
 if root.exists():shutil.rmtree(root)
 root.mkdir()
 copies=[]
 for line in (a.candidate/'Dockerfile').read_text().splitlines():
  if not line.startswith('COPY '):continue
  words=line.split()
  if words[-1] not in ['/app/implementation-runtime/','/app/integration-runtime/']:continue
  dest=root/words[-1].lstrip('/')
  dest.mkdir(parents=True,exist_ok=True)
  for file in words[1:-1]:
   src=source/file;target=dest/src.name
   shutil.copyfile(src,target)
   assert src.read_bytes()==target.read_bytes()
   copies.append({'source':file,'target':str(target.relative_to(root)),**digest(target)})
 for file in ['verification/vector-v014-setup-containment/heldout.test.cjs','integration/runtime/gusto-http-process-recovery.test.cjs','integration/runtime/fixtures/gusto-http-child.cjs']:
  src=a.candidate/file;dest=root/'tmp/vector-integration-admission'/file
  dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
 (root/'copy-manifest.json').write_text(json.dumps(copies,indent=2)+'\n')
 return root
v014='verification/vector-v014-setup-containment/heldout.test.cjs'
v088='integration/runtime/gusto-http-process-recovery.test.cjs'
helpers=['operations/runtime/training-shift-collision.test.cjs','operations/runtime/maintenance-permit-evidence.test.cjs']
checks=[run('candidate-source',a.candidate,[v014,v088,*helpers])]
for label,source in [('baseline-installed',a.baseline),('candidate-installed',a.candidate)]:
 root=materialize(label,source)
 fixture=root/'tmp/vector-integration-admission'
 checks.append(run(label,root,[fixture/v014,fixture/v088],root/'app',expect=1 if label.startswith('baseline') else 0))
 if label.startswith('baseline'):
  text=(a.out/(label+'.tap')).read_text()
  assert 'setup-only tenant reached operational people import' in text
  assert re.search(r'peopleRows: 1',text),text
  assert checks[-1]['counts']=={'tests':4,'pass':3,'fail':1,'skipped':0}
 else:
  assert checks[-1]['counts']=={'tests':4,'pass':4,'fail':0,'skipped':0}
  # Explicit missing-target probe: selector must not fall back to checkout source.
  hub=root/'app/integration-runtime/autonomous-integration-hub.cjs'
  hold=hub.with_suffix('.absent');hub.rename(hold)
  try:
   checks.append(run('missing-installed-module',root,[fixture/v014],root/'app',expect=1))
   text=(a.out/'missing-installed-module.tap').read_text()
   assert 'MODULE_NOT_FOUND' in text
   assert str(hub) in text
  finally:hold.rename(hub)
# Source gate is consumed by hardened-runtime; installed gate is inherited by final.
docker=(a.candidate/'Dockerfile').read_text()
source_stage=docker.split('FROM scratch AS staffology-proof-evidence')[0]
assert all(file in source_stage for file in [v014,v088,*helpers])
hardened=docker.split(' AS hardened-runtime',1)[1].split('FROM hardened-runtime AS installed-archive-proof',1)[0]
assert 'COPY --from=autonomy-proof /proof/portable-autonomy-proof.json' in hardened
assert 'RUN VECTOR_IMAGE_ADMISSION_ROOT=/app node --test --test-concurrency=1' in hardened
assert '&& rm -rf /tmp/vector-integration-admission' in hardened
assert docker.rsplit('FROM ',1)[1].startswith('hardened-runtime\n')
assert docker.count('COPY integration/runtime/fixtures/gusto-http-child.cjs /tmp/vector-integration-admission/')==1
assert 'COPY --from=installed-archive-proof /installed-archive-admitted-source-sha' in docker
receipt={'scope':'COPIED_DECLARED_MODULE_ADMISSION_ONLY','dockerExecuted':False,'nodeVersion':subprocess.check_output([str(a.node),'--version'],text=True).strip(),'checks':checks,'changedFiles':{f:digest(a.candidate/f) for f in ['Dockerfile',v014,'integration/runtime/fixtures/gusto-http-child.cjs']},'claimBoundary':'No Docker binary, image build, hosted/customer/provider execution or canonical adoption.'}
(a.out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'nodeVersion':receipt['nodeVersion'],'checks':[{'name':x['name'],'exit':x['exit'],'counts':x['counts']} for x in checks]},indent=2))
