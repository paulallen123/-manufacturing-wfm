'use strict';

const { createHash } = require('node:crypto');
const FORECAST_VERSION = 'VECTOR_MANUFACTURING_DEMAND_FORECAST_V1';
function text(v,m=180){return String(v??'').trim().slice(0,m);}
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function clamp(v,a,b,f){const n=Number(v);return Number.isFinite(n)?Math.max(a,Math.min(b,n)):f;}
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function sd(xs){if(xs.length<2)return 0;const m=mean(xs);return Math.sqrt(xs.reduce((s,x)=>s+(x-m)*(x-m),0)/(xs.length-1));}
function mae(actual,pred){return actual.length?actual.reduce((s,x,i)=>s+Math.abs(x-pred[i]),0)/actual.length:Infinity;}
function normalise(input){
  const observations=(Array.isArray(input.observations)?input.observations:[]).map((o,i)=>({
    at:o.at?new Date(o.at).toISOString():String(i),
    value:Math.max(0,num(o.value??o.headcount??o.units,NaN)),
    evidenceRef:text(o.evidenceRef,220)||null
  })).filter(o=>Number.isFinite(o.value));
  if(observations.length<4)throw new Error('At least four valid demand observations are required.');
  const horizon=Math.max(1,Math.min(96,Math.trunc(num(input.horizonPeriods,1))));
  const season=Math.max(2,Math.min(168,Math.trunc(num(input.seasonLength,7))));
  return {observations,horizon,season,adjustments:Array.isArray(input.adjustments)?input.adjustments:[],periodMinutes:Math.max(1,Math.min(1440,Math.trunc(num(input.periodMinutes,60))))};
}
function ewma(values,alpha=0.35){let level=values[0];for(let i=1;i<values.length;i++)level=alpha*values[i]+(1-alpha)*level;return level;}
function trend(values){
  const n=values.length,mx=(n-1)/2,my=mean(values);let den=0,nom=0;
  for(let i=0;i<n;i++){const dx=i-mx;den+=dx*dx;nom+=dx*(values[i]-my);} const slope=den?nom/den:0;
  return {intercept:my-slope*mx,slope};
}
function predictModel(name,train,horizon,season){
  const out=[];
  if(name==='MEAN'){const m=mean(train);for(let h=0;h<horizon;h++)out.push(m);return out;}
  if(name==='EWMA'){const l=ewma(train);for(let h=0;h<horizon;h++)out.push(l);return out;}
  if(name==='TREND'){const t=trend(train);for(let h=1;h<=horizon;h++)out.push(Math.max(0,t.intercept+t.slope*(train.length-1+h)));return out;}
  if(name==='SEASONAL'){
    for(let h=0;h<horizon;h++){const idx=train.length-season+(h%season);out.push(Math.max(0,train[Math.max(0,idx)]));}return out;
  }
  throw new Error('Unknown forecast model.');
}
function backtest(values,name,season){
  const holdout=Math.min(8,Math.max(2,Math.floor(values.length/3)));const actual=[],pred=[];
  for(let i=values.length-holdout;i<values.length;i++){
    const train=values.slice(0,i);if(train.length<3)continue;
    if(name==='SEASONAL'&&train.length<season)continue;
    actual.push(values[i]);pred.push(predictModel(name,train,1,season)[0]);
  }
  return {mae:mae(actual,pred),actual,pred,residuals:actual.map((x,i)=>x-pred[i])};
}
function applyAdjustments(value,adjustments){
  let v=value;const evidence=[];
  for(const a of adjustments){const type=text(a.type,30).toUpperCase(),x=num(a.value,0);if(type==='PERCENT')v*=1+x/100;else if(type==='ABSOLUTE')v+=x;else continue;if(a.evidenceRef)evidence.push(text(a.evidenceRef,220));}
  return {value:Math.max(0,v),evidence};
}
function forecastDemand(input={}){
  const x=normalise(input),values=x.observations.map(o=>o.value),names=['MEAN','EWMA','TREND'];if(values.length>=x.season*2)names.push('SEASONAL');
  const tested=names.map(name=>({name,...backtest(values,name,x.season)})).filter(m=>Number.isFinite(m.mae));
  const floor=Math.max(0.001,mean(tested.map(m=>m.mae))*0.05||0.001),inv=tested.map(m=>1/Math.max(floor,m.mae)),sum=inv.reduce((a,b)=>a+b,0)||1;
  const models=tested.map((m,i)=>({name:m.name,mae:Number(m.mae.toFixed(4)),weight:inv[i]/sum}));
  const forecasts=models.map(m=>({name:m.name,weight:m.weight,values:predictModel(m.name,values,x.horizon,x.season)}));
  const residuals=tested.flatMap(m=>m.residuals),residSd=sd(residuals),level=Math.max(1,mean(values));
  const disagreement=Array.from({length:x.horizon},(_,h)=>sd(forecasts.map(f=>f.values[h])));
  const steps=[];const adjustmentEvidence=[];
  for(let h=0;h<x.horizon;h++){
    const raw=forecasts.reduce((s,f)=>s+f.weight*f.values[h],0),adj=applyAdjustments(raw,x.adjustments);adjustmentEvidence.push(...adj.evidence);
    const sigma=Math.sqrt(residSd*residSd+disagreement[h]*disagreement[h]);const p50=Math.max(0,adj.value),p90=Math.max(p50,p50+1.282*sigma);
    steps.push({period:h+1,p50:Number(p50.toFixed(3)),p90:Number(p90.toFixed(3)),uncertainty:Number(sigma.toFixed(3))});
  }
  const cv=sd(values)/level,historyFactor=Math.min(1,values.length/28),confidence=clamp(0.92-0.35*Math.min(1,cv)-0.2*(1-historyFactor),0.2,0.95,0.5);
  const payload={version:FORECAST_VERSION,method:'CHAMPION_WEIGHTED_BASELINE_ENSEMBLE',periodMinutes:x.periodMinutes,historyCount:values.length,seasonLength:x.season,models:models.map(m=>({name:m.name,mae:m.mae,weight:Number(m.weight.toFixed(4))})),confidence:Number(confidence.toFixed(3)),steps,adjustmentEvidence:[...new Set(adjustmentEvidence)],sourceEvidence:[...new Set(x.observations.map(o=>o.evidenceRef).filter(Boolean))],claimBoundary:'FORECAST_BASELINE_NOT_CUSTOMER_ACCURACY_PROOF'};
  return Object.freeze({...payload,forecastId:digest(payload)});
}
function toHeadcountForecast({forecast,unitsPerLabourHour,shiftHours=8}={}){
  if(!forecast||forecast.version!==FORECAST_VERSION||!Array.isArray(forecast.steps)||!forecast.steps.length)throw new Error('Valid VECTOR demand forecast required.');
  const rate=unitsPerLabourHour,duration=shiftHours;
  if(typeof rate!=='number'||typeof duration!=='number'||!Number.isFinite(rate)||!Number.isFinite(duration)||rate<=0||duration<=0)
    throw new Error('Positive finite numeric unitsPerLabourHour and shiftHours are required.');
  const capacity=rate*duration;
  if(!Number.isFinite(capacity)||capacity<=0)throw new Error('Labour capacity must remain finite and positive.');
  const steps=forecast.steps.map(s=>{
    if(!s||typeof s.p50!=='number'||typeof s.p90!=='number'||!Number.isFinite(s.p50)||!Number.isFinite(s.p90)||s.p50<0||s.p90<s.p50)
      throw new Error('Forecast quantities must be finite nonnegative numbers with p90 >= p50.');
    const p50Headcount=Math.ceil(s.p50/capacity),p90Headcount=Math.ceil(s.p90/capacity);
    if(!Number.isSafeInteger(p50Headcount)||!Number.isSafeInteger(p90Headcount)||
      (s.p50>0&&p50Headcount===0)||(s.p90>0&&p90Headcount===0))
      throw new Error('Labour headcount must remain a safe integer without demand underflow.');
    return {period:s.period,p50Headcount,p90Headcount,confidence:forecast.confidence};
  });
  return Object.freeze({version:'VECTOR_LABOUR_DEMAND_TRANSLATION_V1',forecastId:forecast.forecastId,unitsPerLabourHour:rate,shiftHours:duration,steps,claimBoundary:'CAPACITY_TRANSLATION_REQUIRES_CUSTOMER_VALIDATED_RATE'});
}
module.exports={FORECAST_VERSION,forecastDemand,toHeadcountForecast};
