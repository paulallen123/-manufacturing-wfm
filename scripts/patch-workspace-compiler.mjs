// Reuse the sealed compiler with exact IANA zones and reviewed site labels.
import fs from 'node:fs';
const file=process.argv[2];
if(!file)throw Error('Expected extracted configuration compiler path.');
let source=fs.readFileSync(file,'utf8');
const marker='// VECTOR_REAL_IANA_TIMEZONES';
if(!source.includes(marker)){
  const anchor=String.raw`!/^([A-Za-z_]+\/[A-Za-z_+-]+)$/.test(timezone)`;
  if(source.split(anchor).length!==2)throw Error('Sealed compiler timezone anchor changed.');
  source=source.replace(anchor,'!validTimeZone(timezone)');
  source+='\n'+marker+'\nfunction validTimeZone(value){try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}}\n';
  fs.writeFileSync(file,source);
}
const siteNameMarker='// VECTOR_EXACT_SITE_NAMES';
if(!source.includes(siteNameMarker)){
  const anchor='name=clean(x.name,80)';
  if(source.split(anchor).length!==2)throw Error('Sealed compiler site-name anchor changed.');
  source=source.replace(anchor,'name=exactSiteName(x.name)');
  source+='\n'+siteNameMarker+'\nfunction exactSiteName(value){if(typeof value!=="string"||value.length>80||/[\\u0000-\\u001f\\u007f]/.test(value))fail("Site name must be exact text.");return value.trim();}\n';
  fs.writeFileSync(file,source);
}
