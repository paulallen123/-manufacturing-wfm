import {evaluateAgencyWorkStartReadiness} from './agency-work-start-readiness.mjs';
import {
  createPostgresAgencyWorkStartIdentityContinuityStore,
  createPostgresAgencyWorkStartScopedAuthorityStore,
} from './agency-work-start-permit.mjs';
import {AGENCY_WORK_START_SET_LOCAL_ROLE_SQL} from './agency-work-start-db-boundary.mjs';

export const AGENCY_WORK_START_PRECHECK_VERSION='agency-work-start-precheck-v0.1.0';

export function createPostgresAgencyWorkStartPrecheck({withTransaction}={}){
  if(typeof withTransaction!=='function')throw new TypeError('withTransaction function is required');
  return Object.freeze({
    version:AGENCY_WORK_START_PRECHECK_VERSION,
    credentialBoundary:'tenant_bound_session_user_plus_work_start_reader_role',
    evidenceBoundary:'exact_scope_security_definer_functions_only',
    directTableSelectAllowed:false,
    rankingImpact:'none',
    scheduleWriteAuthorized:false,
    clockingWriteAuthorized:false,
    payrollWriteAuthorized:false,
    invoiceWriteAuthorized:false,
    workerMasterWriteAuthorized:false,
    async evaluate(input={}){
      return withTransaction(async transaction=>{
        if(!transaction||typeof transaction.query!=='function')throw new TypeError('transaction.query function is required');
        const query=(sql,params=[])=>transaction.query(sql,params);
        await query(AGENCY_WORK_START_SET_LOCAL_ROLE_SQL,[]);
        const authorityStore=createPostgresAgencyWorkStartScopedAuthorityStore({query});
        const continuityStore=createPostgresAgencyWorkStartIdentityContinuityStore({query});
        return evaluateAgencyWorkStartReadiness({...input,authorityStore,continuityStore});
      });
    },
  });
}
