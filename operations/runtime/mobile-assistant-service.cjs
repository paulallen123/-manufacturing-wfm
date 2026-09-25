'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/mobile/assistant';

function sha256(value){ return createHash('sha256').update(String(value)).digest('hex'); }
function compact(value,max=1200){ return String(value??'').trim().slice(0,max); }
function cookieToken(req){
  for(const part of String(req?.headers?.cookie||'').split(';')){
    const item=part.trim();
    if(item.startsWith('wfm_session=')) return item.slice(12);
  }
  return '';
}
function pathOf(req){ return String(req?.url||'/').split('?')[0]||'/'; }
function writeJson(res,status,body){
  if(res.headersSent||res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req,max=64*1024){
  let size=0;const chunks=[];
  for await(const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=b.length;
    if(size>max){const e=new Error('Request body too large.');e.statusCode=413;throw e;}
    chunks.push(b);
  }
  if(!chunks.length) return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}
}
function collectOutputText(response){
  const chunks=[];
  for(const item of Array.isArray(response?.output)?response.output:[]){
    if(item?.type!=='message') continue;
    for(const part of Array.isArray(item.content)?item.content:[]){
      if(part?.type==='output_text'&&part.text) chunks.push(String(part.text));
    }
  }
  return chunks.join('\n').trim();
}
function toolCalls(response){
  return (Array.isArray(response?.output)?response.output:[]).filter(item=>item?.type==='function_call');
}
function parseArgs(call){
  try{return JSON.parse(String(call?.arguments||'{}'));}
  catch{return {};}
}

function createMobileAssistantService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  const apiKey=options.apiKey||process.env.OPENAI_API_KEY||'';
  const model=options.model||process.env.WFM_ASSISTANT_MODEL||'gpt-5.6';
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const decisionService=options.decisionService||null;
  if(!dbPath) throw new Error('Mobile assistant service requires WFM_DB.');
  if(typeof fetchImpl!=='function') throw new Error('Mobile assistant service requires fetch.');

  const db=new DatabaseSync(dbPath);
  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');

  function ctx(req){
    const token=cookieToken(req);
    return token?auth.get(sha256(token),Date.now())||null:null;
  }
  function requireAuth(req,res){
    const c=ctx(req);
    if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}
    return c;
  }
  function liveContext(c){
    const episodes=decisionService?.recentEpisodes?decisionService.recentEpisodes(c.tenant,12):[];
    return episodes.map(ep=>({
      episodeId:ep.episodeId,
      decisionType:ep.decisionType,
      site:ep.site,
      triggeredAt:ep.triggeredAt,
      contextRevision:ep.contextRevision,
      recommendation:ep.recommendation,
      options:(ep.options||[]).map(o=>({
        id:o.id,label:o.label,feasible:o.feasible,policyAllowed:o.policyAllowed,
        hardConstraintsPassed:o.hardConstraintsPassed,uncertainty:o.uncertainty,
        prediction:o.prediction,reasonCodes:o.reasonCodes,evidenceRefs:o.evidenceRefs
      })),
      sourceEvidence:ep.sourceEvidence
    }));
  }
  function validAction(c,args){
    const episodes=liveContext(c);
    const episode=episodes.find(ep=>ep.episodeId===compact(args.episodeId,180));
    if(!episode) return null;
    const option=episode.options.find(o=>o.id===compact(args.optionId,120));
    if(!option||!option.feasible||!option.policyAllowed||!option.hardConstraintsPassed) return null;
    return {
      type:'RECOMMENDATION_DECISION',
      episodeId:episode.episodeId,
      optionId:option.id,
      contextRevision:episode.contextRevision,
      decision:'APPROVE',
      execute:true,
      label:option.label,
      requiresDeviceConfirmation:true
    };
  }

  async function askModel(c,message,language){
    if(!apiKey) throw Object.assign(new Error('Vecta conversational intelligence is not configured in this environment.'),{statusCode:503});
    const context=liveContext(c);
    const system=[
      'You are Vecta, the customer-facing operations assistant for a manufacturing workforce platform.',
      'Answer in the user requested language ('+language+'). Be concise and operational.',
      'Use only the supplied live Vecta context for customer-specific claims. Never invent an employee, site, decision, metric or action.',
      'You may explain what Vecta can do, but never claim a consequential action has executed unless the application reports a verified execution result.',
      'When the user wants to carry out one of the supplied live recommendation options, call prepare_recommendation_action with the exact episodeId and optionId.',
      'When explaining a supported action that Vecta can perform for the user, end by asking the equivalent of "Would you like me to do this for you?" in the user language.',
      'A tool call only prepares a phone confirmation. It is not authority and is not execution.'
    ].join(' ');

    const response=await fetchImpl('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'authorization':'Bearer '+apiKey,'content-type':'application/json'},
      body:JSON.stringify({
        model,
        instructions:system,
        input:[
          {role:'user',content:[
            {type:'input_text',text:'LIVE VECTA CONTEXT\n'+JSON.stringify({role:c.role,episodes:context})},
            {type:'input_text',text:'USER MESSAGE\n'+message}
          ]}
        ],
        tools:[{
          type:'function',
          name:'prepare_recommendation_action',
          description:'Prepare, but do not execute, the exact Vecta recommendation the authorised user has asked to carry out.',
          parameters:{
            type:'object',
            properties:{
              episodeId:{type:'string'},
              optionId:{type:'string'}
            },
            required:['episodeId','optionId'],
            additionalProperties:false
          },
          strict:true
        }],
        tool_choice:'auto'
      }),
      signal:AbortSignal.timeout(20000)
    });
    const raw=await response.text();
    let body={};
    try{body=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok) throw Object.assign(new Error('Conversational provider request failed safely.'),{statusCode:503,providerStatus:response.status});

    for(const call of toolCalls(body)){
      if(call.name!=='prepare_recommendation_action') continue;
      const actionProposal=validAction(c,parseArgs(call));
      if(!actionProposal) throw Object.assign(new Error('Assistant proposed an action that is not valid in the current Vecta context.'),{statusCode:409});
      return {
        answer:'I have prepared '+actionProposal.label+'. Confirm on this device and Vecta will re-check the live context, permissions and safety gates before anything executes.',
        language,
        actionProposal
      };
    }

    const answer=collectOutputText(body);
    if(!answer) throw Object.assign(new Error('Conversational provider returned no usable answer.'),{statusCode:503});
    return {answer,language,actionProposal:null};
  }

  async function transcribeAudio(body){
    if(!apiKey) throw Object.assign(new Error('Vecta conversational intelligence is not configured in this environment.'),{statusCode:503});
    const audioBase64=String(body?.audioBase64||'').trim();
    if(!audioBase64) throw Object.assign(new Error('Recorded audio is required.'),{statusCode:400});
    if(audioBase64.length>12*1024*1024) throw Object.assign(new Error('Recorded audio is too large. Use a shorter voice turn.'),{statusCode:413});
    if(!/^[A-Za-z0-9+/=]+$/.test(audioBase64)) throw Object.assign(new Error('Recorded audio encoding is invalid.'),{statusCode:400});
    const bytes=Buffer.from(audioBase64,'base64');
    if(!bytes.length||bytes.length>8*1024*1024) throw Object.assign(new Error('Recorded audio is outside the allowed size.'),{statusCode:413});
    const mimeType=['audio/mp4','audio/m4a','audio/x-m4a'].includes(String(body?.mimeType||''))?String(body.mimeType):'audio/mp4';
    const form=new FormData();
    form.append('model',process.env.WFM_TRANSCRIBE_MODEL||'gpt-transcribe');
    form.append('file',new Blob([bytes],{type:mimeType}),'vecta-question.m4a');
    const response=await fetchImpl('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',
      headers:{'authorization':'Bearer '+apiKey},
      body:form,
      signal:AbortSignal.timeout(20000)
    });
    const raw=await response.text();
    let result={};
    try{result=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok) throw Object.assign(new Error('Voice transcription failed safely.'),{statusCode:503,providerStatus:response.status});
    const transcript=compact(result?.text,4000);
    if(!transcript) throw Object.assign(new Error('No speech was detected.'),{statusCode:422});
    return transcript;
  }

  async function handleRequest(req,res){
    const path=pathOf(req);
    if(!path.startsWith(PREFIX)) return false;
    try{
      const c=requireAuth(req,res);if(!c) return true;
      if(req.method==='POST'&&path===PREFIX){
        const body=await readJson(req);
        const message=compact(body.message,4000);
        const language=compact(body.language,40)||'en-GB';
        if(!message) return writeJson(res,400,{error:'message is required.'});
        return writeJson(res,200,await askModel(c,message,language));
      }
      if(req.method==='POST'&&path===PREFIX+'/audio'){
        const body=await readJson(req,12*1024*1024);
        const language=compact(body.language,40)||'en-GB';
        const transcript=await transcribeAudio(body);
        const result=await askModel(c,transcript,language);
        return writeJson(res,200,{transcript,...result});
      }
      return writeJson(res,404,{error:'Mobile assistant endpoint not found.'});
    }catch(error){
      return writeJson(res,Number(error?.statusCode||500),{
        error:error?.statusCode?error.message:'Vecta assistant failed safely.',
        actionPermitted:false
      });
    }
  }

  return {handleRequest,collectOutputText,validAction,close(){try{db.close();}catch{}}};
}

module.exports={createMobileAssistantService,collectOutputText,toolCalls,parseArgs};
