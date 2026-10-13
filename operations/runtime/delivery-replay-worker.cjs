'use strict';
const {serviceFor,verifierFor,post}=require('./delivery-replay-fixture.cjs');
let service,release,work;
process.on('message',async message=>{
 if(message.type==='init'){
  const verify=verifierFor(message.snapshot);
  service=serviceFor({dbPath:message.dbPath},async(input,tenant)=>{
   const attested=verify(input,tenant);process.send({type:'verifier-entered'});
   await new Promise(r=>{release=r;});return attested;
  });
  work=message.snapshot;process.send({type:'ready'});
 }
 if(message.type==='start'){
  try{const response=await post(service,work);process.send({type:'result',response});}
  catch(error){process.send({type:'result',error:String(error)});}
  finally{service.close();process.disconnect();}
 }
 if(message.type==='release-verifier')release();
});
