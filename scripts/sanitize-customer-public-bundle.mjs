import fs from 'node:fs';
import path from 'node:path';

const APPROVED_TITLE='Vector · Workforce';
const replacements=Object.freeze([
  [/INTERACTIVE DESIGN PREVIEW/g,'VECTOR WORKFORCE'],
  [/ERP INGESTION · LOCAL DEVELOPMENT/g,'ERP INGESTION · VECTOR'],
  [/Fictional data · Local development v0\.6 · Changes saved/g,'Environment evidence · Changes saved'],
  [/the authenticated local development database/g,'the authenticated VECTOR database'],
  [/Premium above £100 needs director approval in this sample policy\./g,'Premium above £100 requires director approval under the configured policy.'],
  [/Only the payroll-admin role can review and apply imports in this development build\./g,'Payroll rate imports require payroll administration authority.'],
  [/· Development build/g,'· VECTOR workforce'],
  [/Pay-policy changes need payroll-admin access\. Use Director · Olivia in this sample\./g,'Pay-policy changes require payroll administration authority. Use an authorised company administrator.'],
  [/Local development v0\.6 · Fictional demand and people · Model output is not a published rota, payroll instruction or compliance certificate\./g,'Current environment evidence · Model output is not a published rota, payroll instruction or compliance certificate.'],
  [/Authenticated local development · Changes saved to SQLite/g,'Authenticated VECTOR · Changes saved to the authorised tenant store'],
  [/Fictional company · Development build/g,'VECTOR workforce environment'],
  [/Declared \$\{esc\(a\.declaredAt\?\.slice\(0,10\)\|\|'in this sample'\)\}/g,"Declared ${esc(a.declaredAt?.slice(0,10)||'from the current source')}"] ,
  [/The inherited shift editor is design-only\. Use the tested cover workflow for assignments in this build\./g,'General shift editing is not available here. Use the verified cover workflow for assignments.'],
  [/Organisation editor remains a design requirement\. This build enforces the existing reporting hierarchy; no structural change was made\./g,'Organisation editing is not available here. The current reporting hierarchy remains unchanged.'],
  [/Authenticated local development build\. These are fictional test accounts, not real employees\./g,'Authenticated VECTOR workspace. Environment and data status are shown by the runtime evidence.'],
  [/This server is locked to your computer\. It is not a public deployment\. Never use this sample account setup for real workforce records\./g,'Use only authorised accounts for this environment. Do not reuse access setup across environments.'],
  [/The downloadable sample does not call an AI provider\. Calculated insights are active\. The server contains an optional aggregate-only AI adapter; it needs secure configuration before use\./g,'An AI provider is not configured for this environment. Calculated insights remain available; AI-generated explanations require approved secure configuration.'],
  [/No remote attestation trust policy is configured in this local development runtime\./g,'No remote attestation trust policy is configured for this runtime.'],
  [/This development build uses separate fictional attendance, pattern-roster, work-centre requirement and demand feeds\./g,'This environment uses separate attendance, pattern-roster, work-centre requirement and demand evidence feeds.'],
  [/Draft GB rule pack; local development, not certification/g,'Draft GB rule pack; policy review required, not certification'],
  [/Interactive sample ·/g,'Environment preview ·'],
  [/Session storage only/g,'Session-only storage'],
  [/Fictional people and attendance/g,'Environment workforce and attendance data'],
  [/LOCAL DEVELOPMENT/g,'VECTOR ENVIRONMENT'],
  [/in this sample/g,'in the current environment'],
  [/downloadable sample/g,'current environment'],
  [/development build/g,'current environment'],
  [/local development/g,'current environment'],
  [/fictional test account/gi,'environment account'],
  [/sample account/gi,'environment account'],
  [/design-only/gi,'not available here'],
  [/design requirement/gi,'configuration requirement']
]);

function files(root){
 const out=[];
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  const full=path.join(root,entry.name);
  if(entry.isDirectory())out.push(...files(full));
  else if(entry.isFile()&&entry.name.endsWith('.js'))out.push(full);
 }
 return out.sort();
}

function normalizeTitles(source){
 return source.replace(/document\.title\s*=\s*[^;\n]+;?/g,`document.title='${APPROVED_TITLE}';`);
}

export function sanitizeCustomerBundle(root){
 if(!root||!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw new Error('CUSTOMER_BUNDLE_ROOT_INVALID');
 let changed=0;
 const changedFiles=[];
 const indexPath=path.join(root,'index.html');
 if(fs.existsSync(indexPath)){
  const before=fs.readFileSync(indexPath,'utf8'),titles=[...before.matchAll(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi)];
  if(titles.length!==1)throw new Error('CUSTOMER_HTML_TITLE_COUNT_INVALID');
  const after=before.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/i,'<title>'+APPROVED_TITLE+'</title>');
  if(after!==before){fs.writeFileSync(indexPath,after);changed++;changedFiles.push('index.html');}
 }
 for(const file of files(root)){
  const before=fs.readFileSync(file,'utf8');
  let after=normalizeTitles(before);
  for(const [pattern,replacement] of replacements)after=after.replace(pattern,replacement);
  if(after!==before){fs.writeFileSync(file,after);changed++;changedFiles.push(path.relative(root,file));}
 }
 return Object.freeze({changed,changedFiles:Object.freeze(changedFiles),approvedTitle:APPROVED_TITLE});
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const root=path.resolve(process.argv[2]||'/app/public');
 const result=sanitizeCustomerBundle(root);
 console.log('VECTOR_CUSTOMER_PUBLIC_BUNDLE_SANITIZED=PASS '+JSON.stringify(result));
}
