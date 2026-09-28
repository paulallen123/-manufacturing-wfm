import crypto from 'node:crypto';

export const ENERGY_DATA_MODEL_VERSION = 'energy-data-reconciliation-v0.1.0';

const num=(v)=>Number(v);
const finiteNonNegative=(v)=>Number.isFinite(num(v))&&num(v)>=0;
const stable=(v)=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const hash=(v)=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const hours=(iso)=>{const d=new Date(iso);if(Number.isNaN(d.getTime())) throw new TypeError('invalid timestamp');return d.getUTCHours()+d.getUTCMinutes()/60;};

function requireScope(x,name){
  if(!x?.tenantId||!x?.siteId) throw new TypeError(`${name} requires tenantId and siteId`);
}

export function validateTariffSnapshot(tariff){
  requireScope(tariff,'tariff');
  const errors=[];
  if(!tariff.source?.provider) errors.push('missing_tariff_provider');
  if(!tariff.source?.evidenceType) errors.push('missing_tariff_evidence_type');
  if(!tariff.currency) errors.push('missing_currency');
  if(!['fixed','variable','indexed','time_of_use','dynamic'].includes(tariff.tariffType)) errors.push('unsupported_tariff_type');
  if(!Array.isArray(tariff.unitRates)||tariff.unitRates.length===0) errors.push('missing_unit_rates');
  for(const [i,rate] of (tariff.unitRates??[]).entries()){
    if(!finiteNonNegative(rate.pencePerKWh)) errors.push(`invalid_unit_rate:${i}`);
    if(rate.startHour!==undefined&&!finiteNonNegative(rate.startHour)) errors.push(`invalid_start_hour:${i}`);
    if(rate.endHour!==undefined&&!finiteNonNegative(rate.endHour)) errors.push(`invalid_end_hour:${i}`);
  }
  if(tariff.standingChargePerDay!==undefined&&!finiteNonNegative(tariff.standingChargePerDay)) errors.push('invalid_standing_charge');
  return {valid:errors.length===0,errors};
}

function selectUnitRate(interval,tariff){
  const ts=new Date(interval.start);
  if(Number.isNaN(ts.getTime())) throw new TypeError('interval.start must be ISO timestamp');
  const hour=hours(interval.start);
  const dow=ts.getUTCDay();
  const applicable=(tariff.unitRates??[]).filter(rate=>{
    if(rate.daysOfWeek&&Array.isArray(rate.daysOfWeek)&&!rate.daysOfWeek.includes(dow)) return false;
    if(rate.startHour===undefined||rate.endHour===undefined) return true;
    const start=num(rate.startHour),end=num(rate.endHour);
    return start<=end ? hour>=start&&hour<end : hour>=start||hour<end;
  });
  if(applicable.length!==1) throw new Error(applicable.length===0?'no_applicable_tariff_rate':'ambiguous_tariff_rate');
  return applicable[0];
}

export function priceIntervals({tariff,intervals}){
  const validation=validateTariffSnapshot(tariff);
  if(!validation.valid) return {status:'unpriced',errors:validation.errors};
  if(!Array.isArray(intervals)||intervals.length===0) return {status:'unpriced',errors:['missing_meter_intervals']};
  let kWh=0,variablePence=0;
  const priced=[];
  for(const [i,interval] of intervals.entries()){
    requireScope(interval,`interval:${i}`);
    if(interval.tenantId!==tariff.tenantId||interval.siteId!==tariff.siteId) return {status:'unpriced',errors:[`scope_mismatch:${i}`]};
    if(!finiteNonNegative(interval.kWh)) return {status:'unpriced',errors:[`invalid_kwh:${i}`]};
    if(!interval.source?.provider||!interval.source?.revision) return {status:'unpriced',errors:[`missing_meter_provenance:${i}`]};
    const rate=selectUnitRate(interval,tariff);
    const qty=num(interval.kWh);
    kWh+=qty;
    variablePence+=qty*num(rate.pencePerKWh);
    priced.push({start:interval.start,kWh:qty,rateId:rate.id??null,pencePerKWh:num(rate.pencePerKWh),costGBP:qty*num(rate.pencePerKWh)/100});
  }
  const dates=[...new Set(intervals.map(x=>String(x.start).slice(0,10)))];
  const standingGBP=(num(tariff.standingChargePerDay||0)*dates.length)/100;
  const variableGBP=variablePence/100;
  return {status:'priced',totalKWh:kWh,variableGBP,standingGBP,knownCostGBP:variableGBP+standingGBP,pricedIntervals:priced,sourceHash:hash({tariff,intervals})};
}

export function reconcileActualSpend({tariff,meterIntervals,invoice,ledgerEntry,toleranceGBP=1}){
  const priced=priceIntervals({tariff,intervals:meterIntervals});
  if(priced.status!=='priced') return {status:'unreconciled',reason:'meter_or_tariff_unpriced',details:priced};
  requireScope(invoice,'invoice');
  if(invoice.tenantId!==tariff.tenantId||invoice.siteId!==tariff.siteId) return {status:'unreconciled',reason:'invoice_scope_mismatch'};
  if(!finiteNonNegative(invoice.totalBeforeTaxGBP)) return {status:'unreconciled',reason:'invalid_invoice_total'};
  const knownExtrasGBP=(invoice.knownExtras??[]).reduce((s,x)=>s+(finiteNonNegative(x.amountGBP)?num(x.amountGBP):0),0);
  const modelledInvoiceGBP=priced.knownCostGBP+knownExtrasGBP;
  const invoiceVarianceGBP=num(invoice.totalBeforeTaxGBP)-modelledInvoiceGBP;
  const unpricedCharges=Array.isArray(invoice.unpricedCharges)?invoice.unpricedCharges:[];
  let ledgerVarianceGBP=null;
  if(ledgerEntry){
    requireScope(ledgerEntry,'ledgerEntry');
    if(ledgerEntry.tenantId!==tariff.tenantId||ledgerEntry.siteId!==tariff.siteId) return {status:'unreconciled',reason:'ledger_scope_mismatch'};
    if(!finiteNonNegative(ledgerEntry.postedAmountGBP)) return {status:'unreconciled',reason:'invalid_ledger_amount'};
    ledgerVarianceGBP=num(ledgerEntry.postedAmountGBP)-num(invoice.totalBeforeTaxGBP);
  }
  const invoiceMatched=unpricedCharges.length===0&&Math.abs(invoiceVarianceGBP)<=toleranceGBP;
  const ledgerMatched=ledgerVarianceGBP===null||Math.abs(ledgerVarianceGBP)<=toleranceGBP;
  return {
    status:invoiceMatched&&ledgerMatched?'reconciled':'needs_review',
    meteredKWh:priced.totalKWh,
    calculatedKnownCostGBP:priced.knownCostGBP,
    invoiceBeforeTaxGBP:num(invoice.totalBeforeTaxGBP),
    invoiceVarianceGBP,
    ledgerPostedGBP:ledgerEntry?num(ledgerEntry.postedAmountGBP):null,
    ledgerVarianceGBP,
    unpricedCharges,
    exactSpendClaimAllowed:invoiceMatched&&ledgerMatched,
    provenanceHash:hash({tariff,meterIntervals,invoice,ledgerEntry})
  };
}

export function measureEnergyOutcome({tariff,baselineIntervals,actualIntervals,actualSpendReconciliation,flexibilityRevenueGBP=0,baselineMethod}){
  if(!baselineMethod?.method||!baselineMethod?.evidenceId) return {status:'unverified',reason:'missing_counterfactual_baseline_evidence'};
  const baseline=priceIntervals({tariff,intervals:baselineIntervals});
  const actual=priceIntervals({tariff,intervals:actualIntervals});
  if(baseline.status!=='priced'||actual.status!=='priced') return {status:'unverified',reason:'baseline_or_actual_unpriced'};
  const usageReductionKWh=baseline.totalKWh-actual.totalKWh;
  const avoidedEnergyCostGBP=baseline.variableGBP-actual.variableGBP;
  const flex=finiteNonNegative(flexibilityRevenueGBP)?num(flexibilityRevenueGBP):0;
  const invoiceVerified=actualSpendReconciliation?.status==='reconciled'&&actualSpendReconciliation?.exactSpendClaimAllowed===true;
  return {
    status:invoiceVerified?'invoice_reconciled':'measured_not_invoice_reconciled',
    baselineMethod,
    baselineKWh:baseline.totalKWh,
    actualKWh:actual.totalKWh,
    usageReductionKWh,
    usageReductionPct:baseline.totalKWh===0?null:usageReductionKWh/baseline.totalKWh,
    baselineVariableCostGBP:baseline.variableGBP,
    actualVariableCostGBP:actual.variableGBP,
    avoidedEnergyCostGBP,
    flexibilityRevenueGBP:flex,
    totalOperationalEnergyValueGBP:avoidedEnergyCostGBP+flex,
    actualInvoiceSpendGBP:invoiceVerified?actualSpendReconciliation.invoiceBeforeTaxGBP:null,
    claimBoundary:'usage/cost effects priced under the same actual tariff; supplier tariff changes are not counted as WFM savings',
    provenanceHash:hash({tariff,baselineIntervals,actualIntervals,actualSpendReconciliation,flexibilityRevenueGBP,baselineMethod})
  };
}

export function recommendEnergyDataRoutes(context={}){
  const routes=[];
  routes.push({data:'tariff_and_contract',priority:1,preferred:['supplier_contract_or_portal_api','supplier_invoice_structured_feed'],fallback:['contract_pdf_or_invoice_ingestion','customer_admin_verified_entry'],why:'authoritative rates, standing charges, contract dates and tariff structure'});
  routes.push({data:'half_hourly_usage',priority:1,preferred:['consented_smart_meter_or_advanced_meter_feed','supplier_or_data_collector_api'],future:['consented_smart_data_repository'],fallback:['meter_csv_or_portal_export','site_ems_meter_feed'],why:'actual interval consumption and timing'});
  routes.push({data:'actual_spend',priority:1,preferred:['erp_ap_invoice_or_gl_feed','supplier_invoice_api_or_structured_bill'],fallback:['invoice_document_ingestion'],why:'finance-grade amount actually charged/posted'});
  routes.push({data:'normalisation_context',priority:2,preferred:['mes_production_actuals','operating_hours','weather_or_degree_days_where_relevant'],fallback:['reviewed_manual_period_factors'],why:'credible counterfactual baseline for usage reduction'});
  routes.push({data:'flexibility_revenue',priority:2,preferred:['aggregator_or_supplier_settlement_feed'],fallback:['reviewed_statement_import'],why:'keep flexibility revenue separate from avoided energy spend'});
  return {version:ENERGY_DATA_MODEL_VERSION,country:context.country??'GB',routes};
}
