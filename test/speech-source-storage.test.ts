import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { speechPolicyAllowsAnonymous, SpeechSourceStorage } from '@api/services/speech-source-storage';

test('bucket dedicado recebe áudio privado e preserva mídia original na leitura',async()=>{
  const previous=process.env.SPEECH_S3_BUCKET_NAME;process.env.SPEECH_S3_BUCKET_NAME='media-speech';
  const calls:any[]=[];
  const client={
    bucketExists:async()=>true,getBucketPolicy:async()=>JSON.stringify({Statement:[{Effect:'Allow',Principal:{AWS:'arn:aws:iam::123:user/api'},Action:'s3:*',Resource:'*'}]}),
    putObject:async(bucket:string,key:string,stream:Readable,size:number)=>{let received=0;for await(const chunk of stream)received+=chunk.length;assert.equal(received,size);calls.push(['put',bucket,key]);},
    getObject:async(bucket:string,key:string)=>{calls.push(['get',bucket,key]);return Readable.from([Buffer.from('audio')]);},
    statObject:async(bucket:string,key:string)=>{calls.push(['stat',bucket,key]);return {size:5};},
    removeObject:async(bucket:string,key:string)=>{calls.push(['remove',bucket,key]);},
  };
  try{
    const storage=new SpeechSourceStorage({ENABLE:true,BUCKET_NAME:'media'} as any,client);
    const uploaded=await storage.upload('transcriptions/1/audio.ogg',Readable.from([Buffer.from('audio')]),5,'audio/ogg','hash');
    assert.equal(uploaded.bucket,'media-speech');
    const body=await storage.open(uploaded.bucket,'transcriptions/1/audio.ogg');let text='';for await(const chunk of body)text+=chunk;assert.equal(text,'audio');
    assert.equal(await storage.exists(uploaded.bucket,'transcriptions/1/audio.ogg'),true);
    assert.equal(await storage.remove(uploaded.bucket,'transcriptions/1/audio.ogg'),true);
    const legacy=await storage.open(null,'original.ogg');legacy.destroy();
    assert.deepEqual(calls[0],['put','media-speech','argws-connect-api/transcriptions/1/audio.ogg']);
    assert.deepEqual(calls.at(-1),['get','media','argws-connect-api/original.ogg']);
  }finally{if(previous===undefined)delete process.env.SPEECH_S3_BUCKET_NAME;else process.env.SPEECH_S3_BUCKET_NAME=previous;}
});

test('bucket com política pública existente falha antes do PUT e nunca tem política sobrescrita',async()=>{
  const previous=process.env.SPEECH_S3_BUCKET_NAME;process.env.SPEECH_S3_BUCKET_NAME='media-speech';
  let puts=0;let policyWrites=0;
  const storage=new SpeechSourceStorage({ENABLE:true,BUCKET_NAME:'media'} as any,{
    bucketExists:async()=>true,getBucketPolicy:async()=>JSON.stringify({Statement:[{Effect:'Allow',Principal:'*',Action:'s3:GetObject',Resource:'*'}]}),
    putObject:async()=>{puts++;},setBucketPolicy:async()=>{policyWrites++;},
  });
  try{await assert.rejects(storage.upload('audio.ogg',Readable.from([Buffer.from('audio')]),5,'audio/ogg','hash'),/permite acesso anônimo/);assert.equal(puts,0);assert.equal(policyWrites,0);}
  finally{if(previous===undefined)delete process.env.SPEECH_S3_BUCKET_NAME;else process.env.SPEECH_S3_BUCKET_NAME=previous;}
});

test('política anônima condicional e wildcard em array também são rejeitados',()=>{
  assert.equal(speechPolicyAllowsAnonymous(JSON.stringify({Statement:[{Effect:'Allow',Principal:{AWS:['*']},Condition:{IpAddress:{'aws:SourceIp':'10.0.0.0/8'}}}]})),true);
  assert.equal(speechPolicyAllowsAnonymous(JSON.stringify({Statement:[{Effect:'Deny',Principal:'*'}]})),false);
  assert.equal(speechPolicyAllowsAnonymous(''),false);
});

test('sem permissão para inspecionar a política o upload falha de forma fechada',async()=>{
  const storage=new SpeechSourceStorage({ENABLE:true,BUCKET_NAME:'media'} as any,{
    bucketExists:async()=>true,getBucketPolicy:async()=>{throw Object.assign(new Error('Forbidden'),{code:'AccessDenied'});},
  });
  await assert.rejects(storage.ensurePrivate(),/comprovar a política privada/);
});
