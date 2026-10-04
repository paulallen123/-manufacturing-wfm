const NAME=/^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
const FORBIDDEN=/<!DOCTYPE|<!ENTITY/i;

function fail(message,code='WFM_XML_INVALID'){
  const error=new Error(message);error.code=code;throw error;
}
function text(value,name,max=512){
  if(typeof value!=='string'||!value.trim()) fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail(name+' is invalid');
  return v;
}
function localName(name){const i=name.indexOf(':');return i===-1?name:name.slice(i+1);}
function tagEnd(xml,start){
  let quote=null;
  for(let i=start;i<xml.length;i++){
    const c=xml[i];
    if(quote){if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='>') return i;
  }
  fail('XML tag is not terminated');
}
function decodeEntities(input){
  if(!input.includes('&')) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g,(all,entity)=>{
    if(entity==='lt')return '<';if(entity==='gt')return '>';if(entity==='amp')return '&';if(entity==='quot')return '"';if(entity==='apos')return "'";
    let code;
    if(entity.startsWith('#x'))code=parseInt(entity.slice(2),16);else code=parseInt(entity.slice(1),10);
    if(!Number.isInteger(code)||code<0||code>0x10ffff||(code>=0xd800&&code<=0xdfff))fail('XML numeric entity is invalid');
    const ch=String.fromCodePoint(code);
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ch))fail('XML entity decodes to forbidden control character');
    return ch;
  }).replace(/&[A-Za-z_:][A-Za-z0-9_.:-]*;/g,()=>fail('XML named entity is not allowlisted'));
}
function appendText(node,value,state){
  if(!node){
    if(value.trim())fail('XML text exists outside the root element');
    return;
  }
  const decoded=decodeEntities(value);
  state.textChars+=decoded.length;
  if(state.textChars>state.maxTextChars)fail('XML text exceeds configured limit','WFM_XML_LIMIT');
  node.text.push(decoded);
}
function parseStart(raw){
  let content=raw.trim(),selfClosing=false;
  if(content.endsWith('/')){selfClosing=true;content=content.slice(0,-1).trim();}
  const match=/^([^\s/>]+)/.exec(content);
  if(!match)fail('XML start tag has no name');
  const name=match[1];
  if(!NAME.test(name))fail('XML element name is invalid');
  return {name,selfClosing};
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

export function parseSafeXml(xml,{maxNodes=100000,maxDepth=64,maxTextChars=4_000_000,maxInputChars=8_000_000}={}){
  if(typeof xml!=='string')throw new TypeError('xml must be a string');
  if(xml.length>maxInputChars)fail('XML input exceeds configured limit','WFM_XML_LIMIT');
  if(FORBIDDEN.test(xml))fail('DTD and ENTITY declarations are forbidden','WFM_XML_FORBIDDEN_MARKUP');
  const source=xml.charCodeAt(0)===0xfeff?xml.slice(1):xml;
  const roots=[],stack=[];
  const state={nodes:0,textChars:0,maxTextChars};
  let i=0,seenXmlDeclaration=false;
  while(i<source.length){
    const lt=source.indexOf('<',i);
    if(lt===-1){appendText(stack.at(-1),source.slice(i),state);break;}
    appendText(stack.at(-1),source.slice(i,lt),state);
    if(source.startsWith('<!--',lt)){
      const end=source.indexOf('-->',lt+4);if(end===-1)fail('XML comment is unterminated');
      i=end+3;continue;
    }
    if(source.startsWith('<![CDATA[',lt)){
      const end=source.indexOf(']]>',lt+9);if(end===-1)fail('CDATA section is unterminated');
      appendText(stack.at(-1),source.slice(lt+9,end),state);i=end+3;continue;
    }
    if(source.startsWith('<?',lt)){
      const end=source.indexOf('?>',lt+2);if(end===-1)fail('XML processing instruction is unterminated');
      const body=source.slice(lt+2,end).trim();
      if(!/^xml(?:\s|$)/i.test(body)||seenXmlDeclaration||roots.length||stack.length)fail('Only one leading XML declaration is allowed','WFM_XML_FORBIDDEN_MARKUP');
      seenXmlDeclaration=true;i=end+2;continue;
    }
    if(source.startsWith('<!',lt))fail('Unsupported XML declaration is forbidden','WFM_XML_FORBIDDEN_MARKUP');
    const end=tagEnd(source,lt+1);
    const raw=source.slice(lt+1,end);
    if(raw.startsWith('/')){
      const name=raw.slice(1).trim();
      if(!NAME.test(name))fail('XML end tag name is invalid');
      const current=stack.pop();
      if(!current||current.name!==name)fail('XML closing tag does not match open element');
    }else{
      const {name,selfClosing}=parseStart(raw);
      state.nodes++;if(state.nodes>maxNodes)fail('XML node count exceeds configured limit','WFM_XML_LIMIT');
      if(stack.length+1>maxDepth)fail('XML nesting exceeds configured limit','WFM_XML_LIMIT');
      const node={name,localName:localName(name),text:[],children:[]};
      const parent=stack.at(-1);
      if(parent)parent.children.push(node);else roots.push(node);
      if(roots.length>1)fail('XML document must contain one root element');
      if(!selfClosing)stack.push(node);
    }
    i=end+1;
  }
  if(stack.length)fail('XML document ended with unclosed elements');
  if(roots.length!==1)fail('XML document must contain exactly one root element');
  return roots[0];
}

function nodeText(node){
  if(node.children.length&&node.text.join('').trim())fail('Mixed XML content is not supported in record fields','WFM_XML_MAPPING_INVALID');
  return node.text.join('').trim();
}
function pathArray(value,name){
  if(!Array.isArray(value)||!value.length||value.length>32)fail(name+' must contain 1-32 element names','WFM_XML_MAPPING_INVALID');
  return value.map((v,i)=>{const n=text(v,name+'['+i+']',120);if(!NAME.test(n))fail(name+' contains invalid element name','WFM_XML_MAPPING_INVALID');return localName(n);});
}
function descend(nodes,segment){
  const out=[];
  for(const node of nodes)for(const child of node.children)if(child.localName===segment)out.push(child);
  return out;
}
function selectAbsolute(root,path){
  const segments=pathArray(path,'recordPath');
  if(root.localName!==segments[0])fail('recordPath root does not match XML root','WFM_XML_MAPPING_INVALID');
  let nodes=[root];
  for(const segment of segments.slice(1))nodes=descend(nodes,segment);
  return nodes;
}
function fieldRule(value,name){
  if(Array.isArray(value))return {path:pathArray(value,name),optional:false};
  if(!value||typeof value!=='object'||Array.isArray(value))fail(name+' must be a path or field rule','WFM_XML_MAPPING_INVALID');
  return {path:pathArray(value.path,name+'.path'),optional:value.optional===true};
}
function selectRelative(record,path){
  let nodes=[record];
  for(const segment of path)nodes=descend(nodes,segment);
  return nodes;
}

export function extractXmlRecords({xml,recordPath,fields,maxRecords=100000,parserLimits={}}={}){
  const root=parseSafeXml(xml,parserLimits);
  const records=selectAbsolute(root,recordPath);
  if(records.length>maxRecords)fail('XML record count exceeds configured limit','WFM_XML_LIMIT');
  if(!fields||typeof fields!=='object'||Array.isArray(fields))fail('fields must be a mapping object','WFM_XML_MAPPING_INVALID');
  const rules=Object.fromEntries(Object.entries(fields).map(([key,value])=>{
    const safe=text(key,'field key',80);if(safe==='__proto__'||safe==='prototype'||safe==='constructor')fail('unsafe field key','WFM_XML_MAPPING_INVALID');
    return [safe,fieldRule(value,'fields.'+safe)];
  }));
  const out=records.map((record,index)=>{
    const item={};
    for(const [key,rule] of Object.entries(rules)){
      const nodes=selectRelative(record,rule.path);
      if(nodes.length===0){if(rule.optional)continue;fail('required XML field is missing: '+key,'WFM_XML_MAPPING_INVALID');}
      if(nodes.length!==1)fail('XML field path is ambiguous: '+key,'WFM_XML_MAPPING_INVALID');
      item[key]=nodeText(nodes[0]);
    }
    return item;
  });
  return freeze(out);
}
