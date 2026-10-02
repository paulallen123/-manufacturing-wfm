const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,from=path.resolve(root,'../lane02-jurisdiction/frozen');
const files=fs.readdirSync(path.join(from,'policy/runtime'));
for(const f of files){const dest=path.join(root,'policy/runtime',f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(from,'policy/runtime',f),dest);}
const helper=fs.readFileSync(path.resolve(root,'../lane01-twin/implementation/runtime/inert-finite-json.cjs'));
const blob=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
if(blob(helper)!=='e38b912c9746f69a0dd3c1c991c25f2bbf4d3261')throw Error('helper identity mismatch');
fs.mkdirSync(path.join(root,'implementation/runtime'),{recursive:true});fs.writeFileSync(path.join(root,'implementation/runtime/inert-finite-json.cjs'),helper);
fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
fs.copyFileSync(path.resolve(root,'../lane02-jurisdiction/identities.json'),path.join(root,'frozen-identities.json'));
fs.writeFileSync(path.join(root,'baseline-lock.json'),JSON.stringify({protectedCommit:'f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560',protectedTree:'74aba749449f3f4cd68ee385b24637026ea90ec8',provenBaseSha:null,convergenceBaseSha:null,mode:'ISOLATED_FUTURE_SOURCE_ONLY',helperOwner:'Lane01',helperBlob:blob(helper)},null,2));
