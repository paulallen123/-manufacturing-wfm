const fs=require('node:fs'),path=require('node:path'),base=__dirname;
const b=fs.readFileSync(path.join(base,'owner-evidence/retained-boundaries.held-out.test.mjs'));
fs.writeFileSync(path.join(base,'source/retained-boundaries.held-out.test.mjs'),b);
fs.mkdirSync(path.join(base,'source/evidence'),{recursive:true});
console.log(JSON.stringify({retainedHarnessCopiedExact:true,productSourcesChanged:false}));
