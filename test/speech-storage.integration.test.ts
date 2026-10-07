import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { SpeechSourceStorage } from '@api/services/speech-source-storage';
import * as Minio from 'minio';

const endpoint=process.env.SPEECH_TEST_S3_ENDPOINT;
test('MinIO real: áudio exige autenticação e bucket público preexistente é recusado',{
  skip: !endpoint ? 'Requer SPEECH_TEST_S3_ENDPOINT e credenciais descartáveis; teste de política SDK não comprova GET HTTP.' : false,
  timeout:120_000,
},async()=>{
  const port=Number(process.env.SPEECH_TEST_S3_PORT||19000);
  const configuration:any={ENABLE:true,BUCKET_NAME:'speech-test-'+randomUUID(),ENDPOINT:endpoint,PORT:port,USE_SSL:false,
    ACCESS_KEY:process.env.SPEECH_TEST_S3_ACCESS_KEY,SECRET_KEY:process.env.SPEECH_TEST_S3_SECRET_KEY,REGION:'us-east-1'};
  const client=new Minio.Client({endPoint:endpoint!,port,useSSL:false,accessKey:configuration.ACCESS_KEY,secretKey:configuration.SECRET_KEY,region:'us-east-1'});
  let ready=false;
  for(let attempt=0;attempt<45;attempt++){
    try{await client.listBuckets();ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  assert.equal(ready,true,'MinIO não ficou pronto no prazo do teste.');
  const original=process.env.SPEECH_S3_BUCKET_NAME;
  process.env.SPEECH_S3_BUCKET_NAME=configuration.BUCKET_NAME+'-private';
  const privateBucket=process.env.SPEECH_S3_BUCKET_NAME;
  const storage=new SpeechSourceStorage(configuration,client);
  const key='transcriptions/integration/audio.ogg';
  const object='argws-connect-api/'+key;
  try{
    const stored=await storage.upload(key,Readable.from([Buffer.from('audio')]),5,'audio/ogg','abc');
    assert.equal(stored.bucket,privateBucket);
    const anonymous=await fetch(`http://${endpoint}:${port}/${privateBucket}/${object}`,{signal:AbortSignal.timeout(5000)});
    assert.equal(anonymous.status,403);await anonymous.body?.cancel();
    const authenticated=await storage.open(stored.bucket,key);let text='';for await(const chunk of authenticated)text+=chunk;
    assert.equal(text,'audio');assert.equal(await storage.exists(stored.bucket,key),true);
    assert.equal(await storage.remove(stored.bucket,key),true);assert.equal(await storage.exists(stored.bucket,key),false);

    const publicPolicy=JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:'*',Action:['s3:GetObject'],Resource:[`arn:aws:s3:::${privateBucket}/*`]}]});
    await client.setBucketPolicy(privateBucket,publicPolicy);
    await assert.rejects(storage.upload(key,Readable.from([Buffer.from('audio')]),5,'audio/ogg','abc'),/permite acesso anônimo/);
    assert.deepEqual(JSON.parse(await client.getBucketPolicy(privateBucket)),JSON.parse(publicPolicy));
    assert.equal(await storage.exists(stored.bucket,key),false);
  }finally{
    await client.removeObject(privateBucket,object).catch(()=>{});
    await client.removeBucket(privateBucket).catch(()=>{});
    if(original===undefined)delete process.env.SPEECH_S3_BUCKET_NAME;else process.env.SPEECH_S3_BUCKET_NAME=original;
  }
});
