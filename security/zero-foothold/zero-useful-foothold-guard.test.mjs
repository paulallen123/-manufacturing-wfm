import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateZeroUsefulFoothold} from './zero-useful-foothold-guard.mjs';

function good(){
  return {
    cells:[{id:'cust-a-site-1'}],
    crossCellEdges:[],
    release:{branchProtected:true,commitVerified:true,requiredChecksPassed:true,artifactDigest:'sha256:abc'},
    telemetry:{independentPrimary:true,independentSecondary:true,failClosedOnDisagreement:true},
    recovery:{sameAuthorityAsRuntime:false},
    scaleProfiles:['1/1','small','100','500','2000','10000'].map(id=>({id,proven:true})),
    services:[{
      id:'api',cellId:'cust-a-site-1',environment:'production',public:true,exposureApproved:true,privileged:true,
      listeners:['https'],longLivedSecrets:[],buildSecrets:[],build:{networkInstall:false},
      runtime:{mutableImage:false,imageDigest:'sha256:def',rootUser:false,readOnlyFilesystem:true,packageManagerPresent:false,shellPresent:false},
      egress:{defaultDeny:true,allowHosts:['id.example','db.internal']},
      identity:{mode:'workload',ttlSeconds:300,audience:'wfm-api',cellId:'cust-a-site-1'},
      tripwire:{enabled:true}
    }]
  };
}

const blockCase=(name,mutate,code)=>test(name,()=>{const x=good();mutate(x);const r=evaluateZeroUsefulFoothold(x);assert.equal(r.status,'blocked');assert.equal(r.code,code);});

test('strong single-site profile passes',()=>assert.equal(evaluateZeroUsefulFoothold(good()).status,'pass'));
blockCase('public non-prod without explicit approval is blocked',x=>{x.services[0].environment='staging';x.services[0].exposureApproved=false;},'NONPROD_PUBLIC_EXPOSURE_NOT_APPROVED');
blockCase('long-lived runtime secret is blocked',x=>x.services[0].longLivedSecrets=['STATIC_TOKEN'],'LONG_LIVED_SECRET_PRESENT');
blockCase('build secret is blocked',x=>x.services[0].buildSecrets=['CLOUD_KEY'],'BUILD_SECRET_PRESENT');
blockCase('network package install during build is blocked',x=>x.services[0].build.networkInstall=true,'NETWORK_INSTALL_DURING_BUILD');
blockCase('mutable image is blocked',x=>x.services[0].runtime.mutableImage=true,'IMMUTABLE_IMAGE_REQUIRED');
blockCase('root runtime is blocked',x=>x.services[0].runtime.rootUser=true,'ROOT_RUNTIME_FORBIDDEN');
blockCase('writable runtime filesystem is blocked',x=>x.services[0].runtime.readOnlyFilesystem=false,'READ_ONLY_RUNTIME_REQUIRED');
blockCase('runtime package manager is blocked',x=>x.services[0].runtime.packageManagerPresent=true,'RUNTIME_PACKAGE_MANAGER_FORBIDDEN');
blockCase('unnecessary shell is blocked',x=>x.services[0].runtime.shellPresent=true,'UNNECESSARY_RUNTIME_SHELL_PRESENT');
blockCase('wildcard egress is blocked',x=>x.services[0].egress.allowHosts=['*'],'EGRESS_WILDCARD_FORBIDDEN');
blockCase('long-lived workload identity is blocked',x=>x.services[0].identity.ttlSeconds=7200,'WORKLOAD_IDENTITY_TTL_INVALID');
blockCase('missing public tripwire is blocked',x=>x.services[0].tripwire.enabled=false,'PUBLIC_TRIPWIRE_REQUIRED');
blockCase('single telemetry path on privileged service is blocked',x=>x.telemetry.independentSecondary=false,'DUAL_TELEMETRY_REQUIRED');
blockCase('shared runtime and recovery authority is blocked',x=>x.recovery.sameAuthorityAsRuntime=true,'RECOVERY_AUTHORITY_NOT_INDEPENDENT');
blockCase('unprotected release branch is blocked',x=>x.release.branchProtected=false,'RELEASE_BRANCH_PROTECTION_REQUIRED');
blockCase('unsigned release commit is blocked',x=>x.release.commitVerified=false,'VERIFIED_RELEASE_COMMIT_REQUIRED');
blockCase('missing scale proof is blocked',x=>x.scaleProfiles=x.scaleProfiles.filter(p=>p.id!=='10000'),'SCALE_PROFILE_NOT_PROVEN');
blockCase('unapproved cross-cell edge is blocked',x=>{x.cells.push({id:'cust-b-site-1'});x.crossCellEdges.push({from:'cust-a-site-1',to:'cust-b-site-1',approved:false,leastPrivilege:true,purpose:'reporting'});},'CROSS_CELL_EDGE_NOT_EXPLICITLY_AUTHORISED');
blockCase('agent without kill switch is blocked',x=>{x.services[0].agent=true;x.services[0].agentPolicy={actionBudget:5,killSwitch:false,modelCanGrantAuthority:false,toolBrokered:true};},'AGENT_KILL_SWITCH_REQUIRED');
blockCase('agent self-authority is blocked',x=>{x.services[0].agent=true;x.services[0].agentPolicy={actionBudget:5,killSwitch:true,modelCanGrantAuthority:true,toolBrokered:true};},'MODEL_CREATED_AUTHORITY_FORBIDDEN');

test('10k multi-site profile passes with explicitly authorised narrow edge',()=>{
  const x=good();
  x.cells=[{id:'uk-plant-1'},{id:'de-plant-2'},{id:'shared-reporting'}];
  x.services[0].cellId='uk-plant-1';x.services[0].identity.cellId='uk-plant-1';
  x.services.push({...structuredClone(x.services[0]),id:'de-api',cellId:'de-plant-2',identity:{...x.services[0].identity,cellId:'de-plant-2'}});
  x.crossCellEdges=[{from:'uk-plant-1',to:'shared-reporting',approved:true,leastPrivilege:true,purpose:'deidentified-aggregate'},{from:'de-plant-2',to:'shared-reporting',approved:true,leastPrivilege:true,purpose:'deidentified-aggregate'}];
  assert.equal(evaluateZeroUsefulFoothold(x).status,'pass');
});
