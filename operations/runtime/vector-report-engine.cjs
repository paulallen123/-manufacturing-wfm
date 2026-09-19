'use strict';

function compact(v,max=400){return String(v??'').trim().replace(/\s+/g,' ').slice(0,max);}
function scalar(v){return typeof v==='string'||typeof v==='number'||typeof v==='boolean'?v:null;}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function normalizeMetric(raw={}){
  const label=compact(raw.label,120);
  const value=scalar(raw.value);
  const detail=compact(raw.detail,220);
  if(!label||value===null)return null;
  return {label,value,detail:detail||null};
}
function sanitizeSnapshot(input={}){
  const metrics=Array.isArray(input.metrics)?input.metrics.map(normalizeMetric).filter(Boolean).slice(0,24):[];
  const facts=Array.isArray(input.facts)?input.facts.map(raw=>{
    const label=compact(raw?.label,120),value=scalar(raw?.value),detail=compact(raw?.detail,220);
    return label&&value!==null?{label,value,detail:detail||null}:null;
  }).filter(Boolean).slice(0,40):[];
  const lens=input.decisionLens&&typeof input.decisionLens==='object'?{
    soWhat:compact(input.decisionLens.soWhat,500)||null,
    nextAction:compact(input.decisionLens.nextAction,500)||null
  }:{soWhat:null,nextAction:null};
  return {
    generatedAt:compact(input.generatedAt,50)||new Date().toISOString(),
    role:compact(input.role,60)||null,
    scope:compact(input.scope,80)||null,
    currentScreen:compact(input.currentScreen,80)||null,
    site:compact(input.site,120)||null,
    metrics,
    facts,
    decisionLens:lens
  };
}
function sentenceForMetric(m){
  return m.detail?m.label+': '+m.value+' — '+m.detail+'.':m.label+': '+m.value+'.';
}
function createReport(input={}){
  const snapshot=sanitizeSnapshot(input.snapshot||{});
  const title=compact(input.title||input.request||'Vector report',140)||'Vector report';
  const request=compact(input.request,800);
  const metricLines=snapshot.metrics.map(sentenceForMetric);
  const factLines=snapshot.facts.map(sentenceForMetric);
  const summaryParts=[];
  if(snapshot.decisionLens.soWhat)summaryParts.push(snapshot.decisionLens.soWhat);
  else if(metricLines.length)summaryParts.push(metricLines.slice(0,3).join(' '));
  else summaryParts.push('No verified metric snapshot was supplied for this report.');
  const action=snapshot.decisionLens.nextAction||'Review the underlying evidence before taking an operational action.';
  const metadata=[
    snapshot.site?'Site / scope: '+snapshot.site:null,
    snapshot.role?'Role view: '+snapshot.role:null,
    snapshot.currentScreen?'Source screen: '+snapshot.currentScreen:null,
    'Generated: '+snapshot.generatedAt
  ].filter(Boolean);
  const markdown=[
    '# '+title,'',...metadata,'','## Executive summary',summaryParts.join(' '),'',
    '## Recommended next action',action,'','## Verified metrics',
    ...(metricLines.length?metricLines.map(x=>'- '+x):['- No verified metrics supplied.']),'',
    '## Additional evidence',
    ...(factLines.length?factLines.map(x=>'- '+x):['- No additional scoped facts supplied.']),'',
    '## Request',request||'Generated from the current Vector workspace.','',
    '_Vector reports separate observed evidence from recommendations. Values are not treated as realised savings unless the source evidence says so._'
  ].join('\n');
  const html=[
    '<h1>'+escapeHtml(title)+'</h1>',
    '<p><strong>'+escapeHtml(metadata.join(' · '))+'</strong></p>',
    '<h2>Executive summary</h2><p>'+escapeHtml(summaryParts.join(' '))+'</p>',
    '<h2>Recommended next action</h2><p>'+escapeHtml(action)+'</p>',
    '<h2>Verified metrics</h2><ul>'+(metricLines.length?metricLines:['No verified metrics supplied.']).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>',
    '<h2>Additional evidence</h2><ul>'+(factLines.length?factLines:['No additional scoped facts supplied.']).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>',
    '<hr><p><small>Vector reports separate observed evidence from recommendations. Values are not treated as realised savings unless the source evidence says so.</small></p>'
  ].join('');
  return {title,markdown,html,snapshot};
}

function parseCadence(text,now=new Date()){
  const q=compact(text,1000).toLowerCase();
  const dayNames=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  let frequency=null,dayOfWeek=null,hour=null;
  if(/\b(every day|daily|each day)\b/.test(q))frequency='DAILY';
  if(/\b(every week|weekly|each week)\b/.test(q))frequency='WEEKLY';
  const day=dayNames.findIndex(d=>new RegExp('\\b(every|each)\\s+'+d+'\\b').test(q));
  if(day>=0){frequency='WEEKLY';dayOfWeek=day;}
  if(/\b(every month|monthly|each month)\b/.test(q))frequency='MONTHLY';
  if(/\bmorning\b/.test(q))hour=8;
  else if(/\bafternoon\b/.test(q))hour=15;
  else if(/\bevening\b/.test(q))hour=19;
  const time=q.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if(time){let h=Number(time[1])%12;if(time[3]==='pm')h+=12;hour=h;}
  return {frequency,dayOfWeek,hour,timezone:'TENANT_LOCAL',parsed:Boolean(frequency),parsedAt:now.toISOString()};
}

module.exports={sanitizeSnapshot,createReport,parseCadence};
