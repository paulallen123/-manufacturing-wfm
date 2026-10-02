'use strict';
const {inertJsonCopy}=require('../../implementation/runtime/inert-finite-json.cjs');
const {digest}=require('./decision-episode.cjs');
const INPUT_VERSION='VECTOR_DECLARED_MATERIAL_SCENARIO_V1';
const OUTPUT_VERSION='VECTOR_MATERIAL_SHORTAGE_PROJECTION_V1';
const HOUR_MS=3600000;

function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' object is required');return value;}
function text(value,label,max=180){if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error(label+' binding string is required');return value;}
function utc(value,label){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw Error(label+' requires normalized ISO UTC timestamp');const ms=Date.parse(value);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==value)throw Error(label+' requires calendar-valid ISO UTC timestamp');return ms;}
function quantity(value,label,{positive=false}={}){if(typeof value!=='number'||!Number.isFinite(value)||value<0||(positive&&value===0))throw Error(label+' requires a finite '+(positive?'positive':'non-negative')+' number');return value;}
function finite(value,label){if(!Number.isFinite(value))throw Error(label+' finite arithmetic overflow');return value;}
function ratio(numerator,denominator,label){const value=finite(numerator/denominator,label);if(numerator>0&&value===0)throw Error(label+' numeric precision underflow');return value;}
function product(a,b,label){const value=finite(a*b,label);if(a>0&&b>0&&value===0)throw Error(label+' numeric precision underflow');return value;}
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function observed(record,label,asOf){if(record.status!=='active')throw Error(label+' status must be active');for(const field of ['observedAt','effectiveAt'])if(utc(record[field],label+'.'+field)>asOf)throw Error(label+'.'+field+' is future to asOf');}

// Stateless declared-scenario arithmetic. No producer authentication, event
// selection, ranking, finance, ledger, readiness, permit or mutation authority.
function projectMaterialShortage(raw){
 const input=inertJsonCopy(raw,'material scenario');
 object(input,'scenario');
 if(input.contractVersion!==INPUT_VERSION)throw Error('Declared material scenario contractVersion is required');
 const tenant=text(input.tenant,'tenant'),site=text(input.site,'site'),material=text(input.material,'material'),unit=text(input.unit,'unit',80),asOf=utc(input.asOf,'asOf');
 const source=object(input.source,'source');
 const sourceSystem=text(source.system,'source.system'),sourceVersion=text(source.version,'source.version'),sourceRevision=text(source.revision,'source.revision');
 if(!Array.isArray(source.evidenceRefs)||source.evidenceRefs.length===0||source.evidenceRefs.length>100)throw Error('source evidence refs are required');
 const evidenceRefs=[];for(const ref of source.evidenceRefs){text(ref,'source.evidenceRef',240);if(!evidenceRefs.includes(ref))evidenceRefs.push(ref);}
 const inventory=object(input.inventory,'inventory'),consumption=object(input.consumption,'consumption'),requirement=object(input.requirement,'requirement'),arrival=object(input.arrival,'arrival');
 for(const [label,record] of [['inventory',inventory],['consumption',consumption],['requirement',requirement]])if(text(record.unit,label+'.unit',80)!==unit)throw Error(label+' unit differs from scenario unit');
 observed(inventory,'inventory',asOf);observed(arrival,'arrival',asOf);
 const onHand=quantity(inventory.quantityOnHand,'quantityOnHand'),safetyStock=quantity(inventory.safetyStock,'safetyStock'),rate=quantity(consumption.perHour,'perHour',{positive:true}),requiredQuantity=quantity(requirement.quantity,'requiredQuantity');
 const start=utc(consumption.startsAt,'production.startsAt'),end=utc(consumption.endsAt,'production.endsAt'),expectedArrival=utc(arrival.expectedAt,'arrival.expectedAt');
 if(start<asOf)throw Error('Production window cannot replay past demand before asOf');
 if(end<=start)throw Error('Production window end must follow its start');
 const windowHours=(end-start)/HOUR_MS;
 // Explicitly refuse overflow even when another cap might hide that arithmetic.
 product(rate,windowHours,'window consumption');
 const usableQuantity=Math.max(0,onHand-safetyStock),hoursOfCover=ratio(usableQuantity,rate,'hoursOfCover'),demandHours=ratio(requiredQuantity,rate,'declared demand hours');
 const activeHours=Math.min(windowHours,demandHours),stockoutInsideWindow=hoursOfCover<activeHours;
 const arrivalHours=(expectedArrival-start)/HOUR_MS;
 const shortageHours=stockoutInsideWindow?Math.max(0,Math.min(activeHours,arrivalHours)-hoursOfCover):0;
 const shortageQuantity=Math.min(requiredQuantity,product(rate,shortageHours,'shortageQuantity'));
 const stockoutAt=stockoutInsideWindow?new Date(start+hoursOfCover*HOUR_MS).toISOString():null;
 return freeze({contractVersion:OUTPUT_VERSION,classification:'DECLARED_SCENARIO',authenticity:'NOT_ESTABLISHED',executionAllowed:false,financialValue:null,rankingOwner:'DecisionEpisode',binding:{tenant,site,material,unit,asOf:input.asOf,sourceSystem,sourceVersion,sourceRevision},evidenceRefs,scenarioDigest:digest(input),usableQuantity,hoursOfCover,stockoutAt,shortageHours,shortageQuantity,productionWindow:{startsAt:consumption.startsAt,endsAt:consumption.endsAt},expectedArrivalAt:arrival.expectedAt,assumption:'Declared constant-rate scenario: stated on-hand is available at production-window start; demand ends at its declared quantity or production end. Expected arrival bounds the shortage interval only; no arrival or replenishment is inferred or verified.'});
}

module.exports=Object.freeze({INPUT_VERSION,OUTPUT_VERSION,projectMaterialShortage});
