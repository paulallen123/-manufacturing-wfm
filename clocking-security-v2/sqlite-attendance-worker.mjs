import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { SQLiteAttendanceRuntime } from './sqlite-attendance-runtime.mjs';

const [dbPath,payloadEncoded]=process.argv.slice(2);
if(!dbPath||!payloadEncoded) throw new Error('db path and payload required');
const event=JSON.parse(Buffer.from(payloadEncoded,'base64url').toString('utf8'));
const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000});
const runtime=new SQLiteAttendanceRuntime({filePath:dbPath,engine});
try{
  const receipt=runtime.ingest(event);
  process.stdout.write(JSON.stringify({ok:true,receipt}));
}catch(e){
  process.stdout.write(JSON.stringify({ok:false,status:Number(e?.status)||500,message:String(e?.message||e)}));
  process.exitCode=2;
}finally{
  runtime.close();
}
