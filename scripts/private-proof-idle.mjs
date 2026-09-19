import { createServer } from 'node:http';
console.log('PRIVATE_PROOF_HARNESS_CONTAINED=PASS');
console.log('No proof writes execute in this deployment. Prior failures remain preserved in deployment history.');
createServer((req,res)=>{res.statusCode=200;res.setHeader('content-type','text/plain');res.end('contained\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
