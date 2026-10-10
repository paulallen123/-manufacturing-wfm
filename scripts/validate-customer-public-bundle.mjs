import fs from 'node:fs';
import path from 'node:path';

export const APPROVED_AUTHENTICATED_TITLE='Vector · Workforce';
export const FORBIDDEN_CUSTOMER_COPY=Object.freeze([
  ['development build',/\bdevelopment\s+build\b/i],
  ['local development',/\blocal\s+development\b/i],
  ['interactive design',/\binteractive\s+design\b/i],
  ['interactive prototype',/\binteractive\s+(?:design\s*\/\s*)?prototype\b/i],
  ['fictional test account',/\bfictional\s+test\s+account\b/i],
  ['sample account',/\bsample\s+account\b/i],
  ['downloadable sample',/\bdownloadable\s+sample\b/i],
  ['in this sample',/\bin\s+this\s+sample\b/i],
  ['design-only',/\bdesign[-\s]+only\b/i],
  ['design requirement',/\bdesign\s+requirement\b/i],
  ['development sample',/\bdevelopment\s+sample\b/i],
  ['legacy sample',/\blegacy\s+sample\b/i]
]);

function jsFiles(root){
  const out=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const full=path.join(root,entry.name);
    if(entry.isDirectory())out.push(...jsFiles(full));
    else if(entry.isFile()&&entry.name.endsWith('.js'))out.push(full);
  }
  return out.sort();
}

function literalsAndCommentFree(source){
  const literals=[],clean=[];
  let i=0;
  while(i<source.length){
    const ch=source[i],next=source[i+1];
    if(ch==='/'&&next==='/'){
      clean.push('  ');i+=2;
      while(i<source.length&&source[i]!=='\n'){clean.push(' ');i++;}
      continue;
    }
    if(ch==='/'&&next==='*'){
      clean.push('  ');i+=2;
      while(i<source.length&&!(source[i]==='*'&&source[i+1]==='/')){clean.push(source[i]==='\n'?'\n':' ');i++;}
      if(i<source.length){clean.push('  ');i+=2;}
      continue;
    }
    if(ch==="'"||ch==='"'||ch==='`'){
      const quote=ch,start=i;let raw=ch;i++;
      while(i<source.length){
        const c=source[i];raw+=c;i++;
        if(c==='\\'&&i<source.length){raw+=source[i];i++;continue;}
        if(c===quote)break;
      }
      clean.push(raw);
      literals.push({quote,raw:raw.slice(1,-1),start});
      continue;
    }
    clean.push(ch);i++;
  }
  return {literals,commentFree:clean.join('')};
}

function displaySnippet(value){
  return String(value).replace(/\\[nrt]/g,' ').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,220);
}

export function validatePublicBundle(root){
  if(!root||!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw new Error('PUBLIC_BUNDLE_ROOT_INVALID');
  const violations=[],titleAssignments=[];
  const files=jsFiles(root);
  if(!files.length)throw new Error('PUBLIC_BUNDLE_HAS_NO_JAVASCRIPT');
  const indexPath=path.join(root,'index.html');
  if(fs.existsSync(indexPath)){
    const html=fs.readFileSync(indexPath,'utf8'),titles=[...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
    if(titles.length!==1)violations.push({type:'html-title-count-invalid',file:'index.html',count:titles.length});
    else if(titles[0][1]!==APPROVED_AUTHENTICATED_TITLE)violations.push({type:'unapproved-html-title',file:'index.html',title:displaySnippet(titles[0][1])});
  }
  for(const file of files){
    const relative=path.relative(root,file)||path.basename(file),source=fs.readFileSync(file,'utf8');
    const {literals,commentFree}=literalsAndCommentFree(source);
    for(const literal of literals){
      const rendered=displaySnippet(literal.raw);
      for(const [label,pattern] of FORBIDDEN_CUSTOMER_COPY){
        pattern.lastIndex=0;
        if(pattern.test(rendered))violations.push({type:'customer-copy',label,file:relative,snippet:rendered});
      }
    }
    const titleTokenCount=(commentFree.match(/document\.title\s*=/g)||[]).length;
    const staticTitles=[];let dynamicTitleCount=0;
    const titlePattern=/document\.title\s*=\s*(['"])(.*?)\1/g;
    let match;
    while((match=titlePattern.exec(commentFree))){
      const tail=commentFree.slice(titlePattern.lastIndex),next=(tail.match(/^\s*/)?.[0]?.length??0);
      if(tail[next]&&![ ';','\n','\r',')','}' ].includes(tail[next]))dynamicTitleCount++;
      else staticTitles.push(match[2]);
    }
    dynamicTitleCount+=Math.max(0,titleTokenCount-staticTitles.length-dynamicTitleCount);
    if(dynamicTitleCount)violations.push({type:'dynamic-document-title',file:relative,count:dynamicTitleCount});
    for(const title of staticTitles){
      titleAssignments.push({file:relative,title});
      if(title!==APPROVED_AUTHENTICATED_TITLE)violations.push({type:'unapproved-document-title',file:relative,title});
    }
  }
  if(!titleAssignments.some(item=>item.title===APPROVED_AUTHENTICATED_TITLE))violations.push({type:'approved-document-title-missing',title:APPROVED_AUTHENTICATED_TITLE});
  if(violations.length){
    const error=new Error('VECTOR_CUSTOMER_PUBLIC_BUNDLE_REJECTED:'+JSON.stringify(violations));
    error.violations=violations;
    throw error;
  }
  return Object.freeze({filesScanned:files.length,titleAssignments:Object.freeze(titleAssignments),approvedTitle:APPROVED_AUTHENTICATED_TITLE});
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
  const root=path.resolve(process.argv[2]||'/app/public');
  const result=validatePublicBundle(root);
  console.log('VECTOR_CUSTOMER_PUBLIC_BUNDLE_GUARD=PASS '+JSON.stringify(result));
}
