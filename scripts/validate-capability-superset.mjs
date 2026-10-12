#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root = process.cwd();
const manifestPath = path.join(root, 'release', 'capability-superset.json');
const releasePath = path.join(root, 'release', 'vector-eow-convergence.json');

function fail(message) {
  console.error('VECTOR_CAPABILITY_SUPERSET_GATE=FAIL');
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail('Missing release/capability-superset.json');
if (!fs.existsSync(releasePath)) fail('Missing release/vector-eow-convergence.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));

function verifyRetirementReceipts(capability,requiredProof) {
  const sourceSha=process.env.VECTOR_CANDIDATE_SOURCE_SHA;
  const imageDigest=process.env.VECTOR_CANDIDATE_IMAGE_DIGEST;
  const now=Date.parse(process.env.VECTOR_PROOF_NOW||new Date().toISOString());
  if(!/^[a-f0-9]{40}$/.test(sourceSha||'')||!/^sha256:[a-f0-9]{64}$/.test(imageDigest||'')||!Number.isFinite(now))
    fail(`${capability.id}: exact candidate proof binding is required for retirement.`);
  const receipts=capability.proofReceipts;
  if(!Array.isArray(receipts)||receipts.length!==requiredProof.size)
    fail(`${capability.id}: one evidence receipt is required for every retirement proof.`);
  const evidenceRoot=path.join(root,'release','retirement-evidence');
  const seen=new Set();
  for(const descriptor of receipts){
    const proofType=descriptor?.proofType;
    if(!requiredProof.has(proofType)||seen.has(proofType))
      fail(`${capability.id}: invalid or duplicate retirement receipt.`);
    seen.add(proofType);
    const relative=descriptor?.evidencePath;
    if(typeof relative!=='string'||!/^release\/retirement-evidence\/[a-zA-Z0-9._/-]+\.json$/.test(relative)||
       relative.split('/').includes('..'))
      fail(`${capability.id}: retirement evidence path is invalid.`);
    const absolute=path.resolve(root,relative);
    if(!absolute.startsWith(evidenceRoot+path.sep)||!fs.existsSync(absolute)||!fs.lstatSync(absolute).isFile()||
       !fs.realpathSync(absolute).startsWith(fs.realpathSync(evidenceRoot)+path.sep))
      fail(`${capability.id}: retirement evidence file is missing or invalid.`);
    const bytes=fs.readFileSync(absolute);
    if(bytes.length>1024*1024||createHash('sha256').update(bytes).digest('hex')!==descriptor.evidenceSha256)
      fail(`${capability.id}: retirement evidence bytes do not match the receipt.`);
    let evidence;
    try{evidence=JSON.parse(bytes.toString('utf8'));}catch{fail(`${capability.id}: retirement evidence is not JSON.`);}
    const observed=Date.parse(evidence.observedAt),expires=Date.parse(evidence.expiresAt);
    if(evidence.capabilityId!==capability.id||evidence.proofType!==proofType||evidence.status!=='PASS'||
       evidence.sourceSha!==sourceSha||evidence.imageDigest!==imageDigest||
       !Number.isFinite(observed)||!Number.isFinite(expires)||observed>now||expires<=now||expires<=observed||
       typeof evidence.evidenceRef!=='string'||!evidence.evidenceRef.trim())
      fail(`${capability.id}: retirement receipt is stale, unsuccessful or bound to another candidate.`);
  }
}



if (manifest.schemaVersion !== 1) fail('Unsupported superset manifest schema.');
if (!manifest.policy?.retireLegacyOnlyAfterSupersetProof) fail('Legacy retirement must require superset proof.');
if (manifest.policy?.functionalParityMinimum !== 1) fail('Functional parity floor must remain 100%.');

const requiredProof = new Set(manifest.proofRequiredToRetire || []);
for (const item of [
  'original-behaviour-tests',
  'exact-image-admission',
  'hosted-role-journey',
  'tenant-isolation',
  'refresh-new-login',
  'restart-durability',
  'rollback-or-safe-abstention',
  'before-after-value-evidence'
]) {
  if (!requiredProof.has(item)) fail(`Missing retirement proof requirement: ${item}`);
}

const releaseTargets = new Set((release.target || []).map(x => x.id));
const seen = new Set();
for (const capability of manifest.capabilities || []) {
  if (!capability.id || seen.has(capability.id)) fail(`Invalid or duplicate capability id: ${capability.id}`);
  seen.add(capability.id);

  if (!['retain-source', 'in-development', 'superset-proven'].includes(capability.status)) {
    fail(`${capability.id}: invalid status ${capability.status}`);
  }
  if (!Array.isArray(capability.preservedBehaviors) || capability.preservedBehaviors.length === 0) {
    fail(`${capability.id}: preserved behaviours are required.`);
  }
  if (!Array.isArray(capability.valueAddTargets) || capability.valueAddTargets.length === 0) {
    fail(`${capability.id}: value-add targets are required.`);
  }
  if (!Array.isArray(capability.sourceRefs) || capability.sourceRefs.length === 0) {
    fail(`${capability.id}: source provenance is required.`);
  }
  for (const target of capability.releaseTargetIds || []) {
    if (!releaseTargets.has(target)) fail(`${capability.id}: unknown FORGE release target ${target}`);
  }

  if (!Array.isArray(capability.integratedPaths) || capability.integratedPaths.length === 0) {
    fail(`${capability.id}: integrated source files are required.`);
  }
  for (const rel of capability.integratedPaths) {
    if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) {
      fail(`${capability.id}: invalid integrated source path: ${rel}`);
    }
    const absolute = path.resolve(root, rel);
    const withinRoot = path.relative(root, absolute);
    if (!withinRoot || withinRoot === '..' || withinRoot.startsWith(`..${path.sep}`)) {
      fail(`${capability.id}: integrated source path escapes exact candidate: ${rel}`);
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.realpathSync(absolute) !== absolute) {
      fail(`${capability.id}: integrated source file missing from exact candidate: ${rel}`);
    }
  }

  if (capability.mayRetireLegacySource === true && capability.status !== 'superset-proven') {
    fail(`${capability.id}: legacy source cannot retire before superset-proven.`);
  }
  if (capability.status === 'superset-proven') {
    if (capability.mayRetireLegacySource !== true) {
      fail(`${capability.id}: superset-proven requires explicit retirement decision.`);
    }
    const proof = new Set(capability.proof || []);
    for (const item of requiredProof) {
      if (!proof.has(item)) fail(`${capability.id}: missing superset proof ${item}`);
    }
    verifyRetirementReceipts(capability,requiredProof);
  }
}

const requiredCapabilities = [
  'factory-autopilot',
  'energy-intelligence',
  'cash-to-capacity',
  'agency-labour',
  'automatic-training-video',
  'zero-touch-secure-entry',
  'mobile-tablet-mass-clocking',
  'realtime-ui',
  'autonomous-integrations',
  'customer-outcome-learning'
];
for (const id of requiredCapabilities) {
  if (!seen.has(id)) fail(`Critical Friday capability missing from superset manifest: ${id}`);
}

console.log(`VECTOR_CAPABILITY_SUPERSET_GATE=PASS capabilities=${seen.size} retirementProofs=${requiredProof.size}`);


