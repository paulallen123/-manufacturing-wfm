import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const parity=JSON.parse(fs.readFileSync(path.join(root,'parity.json'),'utf8'));
const profile=String(process.env.EAS_BUILD_PROFILE||process.env.VECTOR_BUILD_PROFILE||'development');
const production=profile==='production'||process.env.VECTOR_STORE_GATE==='1';
const incomplete=parity.routes.filter(item=>item.coverage!=='native'&&!item.exception);

console.log(JSON.stringify({
  gate:'VECTOR_MOBILE_STORE_PARITY_V1',
  profile,
  total:parity.routes.length,
  native:parity.routes.filter(item=>item.coverage==='native').length,
  incomplete:incomplete.map(item=>item.route)
},null,2));

if(production&&incomplete.length){
  console.error('Production store build refused: mobile/web parity is incomplete.');
  process.exit(1);
}
