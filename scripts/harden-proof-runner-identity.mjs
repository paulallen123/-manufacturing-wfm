import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve(process.argv[2] || 'public');
const serverPath = path.join(path.dirname(publicRoot), 'server.cjs');

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw Error(`Unable to apply ${label}: expected one exact insertion point.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let server = fs.readFileSync(serverPath, 'utf8');
if (!server.includes('function passkeyDecode(') || !server.includes('createPublicKey,verify')) {
  throw Error('Proof-runner identity requires the passkey authentication overlay to be applied first.');
}

server = replaceOnce(
  server,
  'CREATE INDEX IF NOT EXISTS passkey_challenges_expiry ON passkey_challenges(expires);',
  `CREATE INDEX IF NOT EXISTS passkey_challenges_expiry ON passkey_challenges(expires);
CREATE TABLE IF NOT EXISTS proof_runner_challenges(id TEXT PRIMARY KEY,kid TEXT NOT NULL,nonce_hash TEXT NOT NULL,audience TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS proof_runner_challenges_expiry ON proof_runner_challenges(expires);`,
  'proof-runner challenge table',
);

server = replaceOnce(
  server,
  "for(const [name,ddl] of [['issued_at','INTEGER'],['last_seen','INTEGER'],['source_hash','TEXT'],['source_basis','TEXT'],['source_authoritative','INTEGER NOT NULL DEFAULT 0'],['client_hash','TEXT']])if(!sessionColumns.has(name))db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${ddl}`);",
  "for(const [name,ddl] of [['issued_at','INTEGER'],['last_seen','INTEGER'],['source_hash','TEXT'],['source_basis','TEXT'],['source_authoritative','INTEGER NOT NULL DEFAULT 0'],['client_hash','TEXT'],['auth_method','TEXT'],['auth_subject','TEXT'],['proof_scope','TEXT']])if(!sessionColumns.has(name))db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${ddl}`);",
  'proof-runner session metadata',
);

const helpers = `function passkeySession(req,user){const source=requestSource(req),sourceHash=tokenHash(source.identity).slice(0,24),token=randomBytes(32).toString('hex'),issuedAt=Date.now(),clientHash=clientFingerprint(req);db.prepare('INSERT INTO sessions(token_hash,email,expires,issued_at,last_seen,source_hash,source_basis,source_authoritative,client_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(tokenHash(token),user.email,issuedAt+3600000,issuedAt,issuedAt,source.containmentEligible?sourceHash:null,source.containmentEligible?source.basis:null,source.containmentEligible?1:0,clientHash);return token;}
const PROOF_RUNNER_CHALLENGE_TTL_MS=30_000;
function proofRunnerConfigs(){E.assert(process.env.WFM_PROOF_RUNNER_ENABLED==='true','Proof-runner identity is disabled.',503);let parsed;try{parsed=JSON.parse(process.env.WFM_PROOF_RUNNER_KEYS_JSON||'[]');}catch{E.assert(false,'Proof-runner identity configuration is invalid.',503);}E.assert(Array.isArray(parsed)&&parsed.length>0&&parsed.length<=20,'Proof-runner identity configuration is invalid.',503);const seen=new Set();return parsed.map(item=>{E.assert(item&&Object.keys(item).every(k=>['kid','publicKey','email','tenant','allowed','maxSessionSeconds'].includes(k)),'Proof-runner identity configuration contains unsupported fields.',503);const kid=String(item.kid||''),email=String(item.email||'').trim().toLowerCase(),tenant=String(item.tenant||''),allowed=Array.isArray(item.allowed)?[...new Set(item.allowed.map(String))]:[],maxSessionSeconds=Number(item.maxSessionSeconds);E.assert(/^[A-Za-z0-9_.:-]{6,80}$/.test(kid)&&!seen.has(kid),'Proof-runner key identity is invalid or duplicated.',503);seen.add(kid);E.assert(/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)&&/^[A-Za-z0-9_.:-]{3,80}$/.test(tenant),'Proof-runner account scope is invalid.',503);E.assert(allowed.length>0&&allowed.length<=50&&allowed.every(x=>/^(GET|POST) \\/api\\/[A-Za-z0-9_.:/-]+$/.test(x)&&!x.includes('/proof-runner/')),'Proof-runner route scope is invalid.',503);E.assert(Number.isInteger(maxSessionSeconds)&&maxSessionSeconds>=30&&maxSessionSeconds<=300,'Proof-runner session must be 30–300 seconds.',503);const publicKeyBytes=passkeyDecode(item.publicKey,'Proof-runner public key',2048),publicKey=createPublicKey({key:publicKeyBytes,format:'der',type:'spki'});E.assert(publicKey.asymmetricKeyType==='ed25519','Proof-runner keys must use Ed25519.',503);return {kid,email,tenant,allowed,maxSessionSeconds,publicKey};});}
function proofRunnerConfig(kid){const config=proofRunnerConfigs().find(x=>x.kid===kid);E.assert(config,'Proof-runner identity is not trusted.',401);return config;}
function proofRunnerAudience(req){const requestAudience=HOSTED_STAGING?PUBLIC_ORIGIN:'http://'+String(req.headers.host||''),configured=String(process.env.WFM_PROOF_RUNNER_AUDIENCE||'');E.assert(configured===requestAudience,'Proof-runner audience is not bound to this runtime.',503);return requestAudience;}
function proofRunnerCanonical(a){return Buffer.from(['vector-proof-runner-v1',a.kid,a.challengeId,a.nonce,a.audience,String(a.issuedAt),String(a.expiresAt)].join('\\n'));}
function proofRunnerAuthorise(a,method,pathname){if(a.authMethod!=='proof-runner')return;const config=proofRunnerConfig(a.authSubject);E.assert(config.email===a.email&&config.tenant===a.tenant,'Proof-runner account binding changed.',401);const operation=method+' '+pathname,sessionScope=Array.isArray(a.proofScope)?a.proofScope:[];E.assert(config.allowed.includes(operation)&&sessionScope.includes(operation),'Proof-runner session is not authorised for this operation.',403);}`;
server = replaceOnce(
  server,
  "function passkeySession(req,user){const source=requestSource(req),sourceHash=tokenHash(source.identity).slice(0,24),token=randomBytes(32).toString('hex'),issuedAt=Date.now(),clientHash=clientFingerprint(req);db.prepare('INSERT INTO sessions(token_hash,email,expires,issued_at,last_seen,source_hash,source_basis,source_authoritative,client_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(tokenHash(token),user.email,issuedAt+3600000,issuedAt,issuedAt,source.containmentEligible?sourceHash:null,source.containmentEligible?source.basis:null,source.containmentEligible?1:0,clientHash);return token;}",
  helpers,
  'proof-runner helpers',
);

server = replaceOnce(
  server,
  's.source_basis AS session_source_basis,s.source_authoritative AS session_source_authoritative,s.client_hash AS session_client_hash',
  's.source_basis AS session_source_basis,s.source_authoritative AS session_source_authoritative,s.client_hash AS session_client_hash,\n    s.auth_method AS session_auth_method,s.auth_subject AS session_auth_subject,s.proof_scope AS session_proof_scope',
  'proof-runner actor query',
);

server = replaceOnce(
  server,
  "return {email:u.email,tenant:u.tenant,personId:u.person_id,personnelId:u.personnel_id||null,role:u.role,costs:!!u.costs,permissions:JSON.parse(u.permissions||'[]')};",
  "return {email:u.email,tenant:u.tenant,personId:u.person_id,personnelId:u.personnel_id||null,role:u.role,costs:!!u.costs,permissions:JSON.parse(u.permissions||'[]'),authMethod:u.session_auth_method||null,authSubject:u.session_auth_subject||null,proofScope:u.session_proof_scope?JSON.parse(u.session_proof_scope):null};",
  'proof-runner actor result',
);

const routes = `if(url.pathname==='/api/proof-runner/challenge'&&req.method==='POST'){
 const input=await body(req),kid=String(input.kid||''),config=proofRunnerConfig(kid),now=Date.now(),audience=proofRunnerAudience(req);db.prepare('DELETE FROM proof_runner_challenges WHERE expires<=?').run(now);E.assert(Number(db.prepare('SELECT COUNT(*) AS n FROM proof_runner_challenges').get().n)<1000,'Proof-runner challenge capacity is temporarily exhausted.',429);E.assert(Number(db.prepare('SELECT COUNT(*) AS n FROM proof_runner_challenges WHERE kid=?').get(kid).n)<5,'Too many outstanding proof-runner challenges.',429);const id=randomBytes(24).toString('base64url'),nonce=randomBytes(32).toString('base64url'),expires=now+PROOF_RUNNER_CHALLENGE_TTL_MS;db.prepare('INSERT INTO proof_runner_challenges(id,kid,nonce_hash,audience,expires) VALUES(?,?,?,?,?)').run(id,config.kid,tokenHash(nonce),audience,expires);return json(res,200,{challengeId:id,nonce,audience,expiresAt:expires,algorithm:'Ed25519'});
}
if(url.pathname==='/api/proof-runner/session'&&req.method==='POST'){
 const input=await body(req),assertion=input.assertion||{},kid=String(assertion.kid||''),challengeId=String(assertion.challengeId||''),row=db.prepare('SELECT * FROM proof_runner_challenges WHERE id=? AND kid=?').get(challengeId,kid);if(row)db.prepare('DELETE FROM proof_runner_challenges WHERE id=?').run(challengeId);const now=Date.now();E.assert(row&&row.expires>now,'Proof-runner challenge expired or was already used.',409);const config=proofRunnerConfig(kid),audience=proofRunnerAudience(req),issuedAt=Number(assertion.issuedAt),expiresAt=Number(assertion.expiresAt);E.assert(assertion.audience===audience&&row.audience===audience,'Proof-runner audience rejected.',403);E.assert(row.nonce_hash===tokenHash(String(assertion.nonce||'')),'Proof-runner nonce rejected.',403);E.assert(Number.isSafeInteger(issuedAt)&&Number.isSafeInteger(expiresAt)&&issuedAt>=now-30_000&&issuedAt<=now+5_000&&expiresAt>now&&expiresAt<=issuedAt+PROOF_RUNNER_CHALLENGE_TTL_MS,'Proof-runner assertion lifetime rejected.',403);const signature=passkeyDecode(input.signature,'Proof-runner signature',1024);E.assert(verify(null,proofRunnerCanonical(assertion),config.publicKey,signature),'Proof-runner signature rejected.',401);const user=db.prepare('SELECT * FROM users WHERE email=?').get(config.email);E.assert(user&&user.tenant===config.tenant,'Proof-runner account binding is unavailable.',503);const source=requestSource(req),sourceHash=tokenHash(source.identity).slice(0,24),token=randomBytes(32).toString('hex'),clientHash=clientFingerprint(req),sessionExpires=now+config.maxSessionSeconds*1000;db.prepare('INSERT INTO sessions(token_hash,email,expires,issued_at,last_seen,source_hash,source_basis,source_authoritative,client_hash,auth_method,auth_subject,proof_scope) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(tokenHash(token),user.email,sessionExpires,now,now,source.containmentEligible?sourceHash:null,source.containmentEligible?source.basis:null,source.containmentEligible?1:0,clientHash,'proof-runner',config.kid,JSON.stringify(config.allowed));db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(user.tenant,'proof-runner:'+config.kid,'proof-runner-session-issued',JSON.stringify({email:user.email,sessionRef:tokenHash(token).slice(0,24),scopeCount:config.allowed.length,expiresAt:sessionExpires}),new Date(now).toISOString());return json(res,200,{ok:true,authMethod:'proof-runner',expiresInSeconds:config.maxSessionSeconds},{'Set-Cookie':\`wfm_session=\${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=\${config.maxSessionSeconds}\${HOSTED_STAGING?'; Secure':''}\`});
}
`;
server = replaceOnce(
  server,
  "if(url.pathname==='/api/passkeys/login/options'&&req.method==='POST')",
  routes + "if(url.pathname==='/api/passkeys/login/options'&&req.method==='POST')",
  'proof-runner exchange routes',
);

server = replaceOnce(
  server,
  "if(url.pathname.startsWith('/api/')){const a=actor(req);",
  "if(url.pathname.startsWith('/api/')){const a=actor(req);proofRunnerAuthorise(a,req.method,url.pathname);",
  'proof-runner path authorisation',
);

fs.writeFileSync(serverPath, server);
console.log('WFM_PROOF_RUNNER_IDENTITY=PASS');
