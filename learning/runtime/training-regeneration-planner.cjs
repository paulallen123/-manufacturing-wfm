'use strict';

const { affectedCompetencies, buildTrainingModule, roleCanUse, workflowFor } = require('./training-workflow-manifest.cjs');
const { createVideoGenerationJob } = require('./training-video-contract.cjs');

const DEFAULT_ROLES=Object.freeze(['employee','manager','payroll','admin']);

function unique(values){return [...new Set((Array.isArray(values)?values:[]).map(String).filter(Boolean))];}

function planTrainingRegeneration(input={}){
  const changedDependencies=unique(input.changedDependencies);
  if(!changedDependencies.length) throw new Error('At least one changed training dependency is required.');
  const productSha=String(input.productSha||'');
  const targetOrigin=String(input.targetOrigin||'');
  const roles=unique(input.roles).length?unique(input.roles):[...DEFAULT_ROLES];
  const locales=unique(input.locales).length?unique(input.locales):['en-GB'];
  const competencies=affectedCompetencies(changedDependencies);
  const jobs=[],pendingAnchors=[],localisationRequired=[],notAssigned=[];

  for(const competencyKey of competencies){
    const workflow=workflowFor(competencyKey);
    for(const role of roles){
      if(!roleCanUse(workflow,role)){notAssigned.push({competencyKey,role});continue;}
      for(const locale of locales){
        const module=buildTrainingModule({
          competencyKey,role,mode:'SHOW_ME',locale,
          explanationMode:input.explanationMode||'step-by-step',
          permissionClass:input.permissionClass||'default',
          configurationClass:input.configurationClass||'standard',
          productSha,
          uiVersion:input.uiVersion||'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'
        });
        if(module.capture.status!=='READY'){
          pendingAnchors.push({competencyKey,role,locale,fingerprint:module.artifactFingerprint});
          continue;
        }
        if(locale!=='en-GB'){
          localisationRequired.push({competencyKey,role,locale,fingerprint:module.artifactFingerprint});
          continue;
        }
        jobs.push(createVideoGenerationJob(module,{targetOrigin}));
      }
    }
  }
  return Object.freeze({
    contractVersion:'VECTOR_TRAINING_REGENERATION_PLAN_V1',
    changedDependencies,
    competencies,
    jobCount:jobs.length,
    jobs,
    pendingAnchors,
    localisationRequired,
    notAssigned
  });
}

module.exports={planTrainingRegeneration,DEFAULT_ROLES};
