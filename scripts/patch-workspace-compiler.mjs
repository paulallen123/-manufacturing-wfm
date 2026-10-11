// Reuse the sealed compiler; correct only its overly restrictive timezone check.
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
