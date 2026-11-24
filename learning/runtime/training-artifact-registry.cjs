'use strict';

const { DatabaseSync } = require('node:sqlite');
const { assessVideoReceipt } = require('./training-video-contract.cjs');

function createTrainingArtifactRegistry(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  if(!dbPath) throw new Error('Training artifact registry requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS training_artifact_events('+
      'id INTEGER PRIMARY KEY AUTOINCREMENT,fingerprint TEXT NOT NULL,state TEXT NOT NULL,'+
      'job_json TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL);'+
    'CREATE INDEX IF NOT EXISTS training_artifact_fingerprint ON training_artifact_events(fingerprint,id);'+
    'CREATE TRIGGER IF NOT EXISTS no_training_artifact_event_update BEFORE UPDATE ON training_artifact_events '+
      "BEGIN SELECT RAISE(ABORT,'Training artifact evidence is append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_training_artifact_event_delete BEFORE DELETE ON training_artifact_events '+
      "BEGIN SELECT RAISE(ABORT,'Training artifact evidence is append only.'); END;"
  );
  const insert=db.prepare('INSERT INTO training_artifact_events(fingerprint,state,job_json,receipt_json,created_at) VALUES(?,?,?,?,?)');
  const latest=db.prepare('SELECT * FROM training_artifact_events WHERE fingerprint=? ORDER BY id DESC LIMIT 1');
  function publicView(row){
    if(!row) return null;
    const receipt=JSON.parse(row.receipt_json);
    return {
      state:row.state,
      fingerprint:row.fingerprint,
      generatedAt:row.created_at,
      durationMs:Number(receipt.media?.durationMs||0),
      captionsAvailable:Boolean(receipt.media?.captionsSha256),
      transcriptAvailable:Boolean(receipt.media?.transcriptSha256),
      narrationAvailable:receipt.narration?.status==='PRESENT',
      videoUrl:row.state==='READY'?receipt.publication?.videoUrl||null:null,
      captionsUrl:row.state==='READY'?receipt.publication?.captionsUrl||null:null,
      transcriptUrl:row.state==='READY'?receipt.publication?.transcriptUrl||null:null
    };
  }
  function currentForFingerprint(fingerprint){return publicView(latest.get(String(fingerprint||'')));}
  function recordReceipt(job,receipt){
    const {admissible,validation}=assessVideoReceipt(job,receipt);
    // A structural rejection is not admitted artifact evidence. Keep prior
    // history and its current view unchanged; semantic FAILED events still append.
    if(!admissible) return {validation,artifact:null};
    insert.run(job.artifactFingerprint,validation.state,JSON.stringify(job),JSON.stringify(receipt),new Date().toISOString());
    return {validation,artifact:currentForFingerprint(job.artifactFingerprint)};
  }
  return {recordReceipt,currentForFingerprint,close(){try{db.close();}catch{}}};
}
module.exports={createTrainingArtifactRegistry};
