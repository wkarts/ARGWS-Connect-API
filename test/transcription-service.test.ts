import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { stat } from 'node:fs/promises';

import express from 'express';

import { receiveSpeechUpload } from '@api/routes/speech-upload.middleware';
import { SpeechRouter } from '@api/routes/speech.router';
import { SpeechDurableService } from '@api/services/speech-durable.service';
import { getConfiguredSpeechModel } from '@api/services/speech-model-download.service';
import { publishSpeechConfirmed, speechHash, speechScopeKey, TranscriptionServiceError } from '@api/services/speech-policy';
import { normalizeTranscriptionAudioMime, TranscriptionService } from '@api/services/transcription.service';

import { queuedSpeechJob, speechFixture } from './helpers/speech-fixture';

const control = (job: any, action: string, extra: any = {}) => ({ version: 2, poolId: job.poolId,
  jobId: job.id, generation: job.generation, workerId: 'test-worker', action, ...extra });
const completion = (job: any) => ({ text: 'O áudio foi transcrito.', durationMs: 1000, language: 'pt',
  effectiveModel: job.requestedModel, engine: job.requestedEngine, modelRevision: job.requestedRevision });

test('init concorrente conserva uma conexão e não provisiona modelo sem opt-in', async () => {
  const previous = process.env.SPEECH_ENABLED; process.env.SPEECH_ENABLED = 'true';
  try {
    const service = new TranscriptionService({} as any); let connections = 0;
    (service as any).startSourceCleanup = () => {}; (service as any).startStaleRecovery = () => {};
    (service as any).modelDownloadService.status = () => { throw new Error('não deve provisionar'); };
    (service as any).connect = async () => { connections++; await Promise.resolve(); Object.assign(service,{ connection: {}, channel: {}, resultChannel: {} }); };
    await Promise.all(Array.from({ length: 30 }, () => service.init()));
    await service.init(); assert.equal(connections, 1);
  } finally { if (previous === undefined) delete process.env.SPEECH_ENABLED; else process.env.SPEECH_ENABLED = previous; }
});

test('MIME MediaRecorder é normalizado sem aceitar conteúdo arbitrário como áudio', () => {
  assert.equal(normalizeTranscriptionAudioMime('audio/webm;codecs=opus', 'fala.webm'), 'audio/webm');
  assert.equal(normalizeTranscriptionAudioMime('video/webm', 'fala.webm'), 'audio/webm');
  assert.equal(normalizeTranscriptionAudioMime('', 'fala.m4a'), 'audio/mp4');
  assert.equal(normalizeTranscriptionAudioMime('application/pdf', 'fala.webm'), '');
});

test('claim concorrente e entrega duplicada concedem um único executionId (fixture; SQL validado em integração)', async () => {
  const f = speechFixture(); const job = queuedSpeechJob(); f.seed('transcriptionJob', job);
  const service = new SpeechDurableService(f.repository, (value) => value);
  const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => service.control(control(job,'claim',{ workerId: 'worker-' + index }))));
  assert.equal(claims.filter((claim) => claim.granted).length, 1);
  assert.ok(f.rows('transcriptionJob')[0].executionId);
  assert.equal(f.rows('transcriptionJob')[0].status, 'processing');
});

test('cancelamento durável impede claim e mantém capacidade até supervisor confirmar morte', async () => {
  const f = speechFixture(); const job = queuedSpeechJob(); const second = queuedSpeechJob(); f.seed('transcriptionJob',job); f.seed('transcriptionJob',second);
  const service = new SpeechDurableService(f.repository,(value)=>value);
  const claim = await service.control(control(job,'claim'));
  await service.cancel(job.id);
  const heartbeat = await service.control(control(job,'lease',{ executionId: claim.executionId }));
  assert.equal(heartbeat.cancelRequested,true); assert.equal(heartbeat.granted,false);
  assert.equal((await service.control(control(second,'claim'))).reason,'CAPACITY_EXHAUSTED');
  await service.control(control(job,'finish',{ executionId: claim.executionId, status: 'cancelled' }));
  assert.equal((await service.control(control(second,'claim'))).granted,true);
  assert.equal(f.rows('transcriptionJob')[0].status,'cancelled');
});

test('job terminal nunca concede execução mesmo após reinício do consumidor', async () => {
  const f=speechFixture(); const job=queuedSpeechJob({status:'completed'}); f.seed('transcriptionJob',job);
  const service=new SpeechDurableService(f.repository,(value)=>value);
  assert.deepEqual(await service.control(control(job,'claim')),{ok:true,granted:false,reason:'COMPLETED',terminal:true,cancelRequested:false});
  assert.equal(f.rows('transcriptionJob')[0].executionId,null);
});

test('checkpoint/yield gera token novo e resultado antigo não sobrescreve a execução atual',async()=>{
  const f=speechFixture(); const job=queuedSpeechJob(); f.seed('transcriptionJob',job);
  const service=new SpeechDurableService(f.repository,(value)=>({id:value.id,generation:value.generation}));
  const first=await service.control(control(job,'claim'));
  const released=await service.control(control(job,'release',{executionId:first.executionId,reason:'yield',checkpoint:{nextChunkIndex:1,offsetSamples:480000,processedDurationMs:30000,durationMs:30000,durationKnown:false,text:'Primeiro trecho',sourceSha256:'abc'}}));
  assert.equal(released.generation,2); assert.equal(f.rows('transcriptionJob')[0].attempts,1);
  assert.equal(f.rows('transcriptionJob')[0].progressPercent,0);
  assert.equal(f.rows('speechOutbox')[0].generation,2);
  const second=await service.control(control({...job,generation:2},'claim'));
  assert.notEqual(second.executionId,first.executionId);
  const stale=await service.control(control(job,'finish',{executionId:first.executionId,status:'completed',result:completion(job)}));
  assert.equal(stale.granted,false); assert.equal(stale.reason,'STALE_GENERATION');
  assert.equal(f.rows('transcriptionJob')[0].text,'Primeiro trecho');
});

test('heartbeat do coordenador renova lease sem inventar progresso do motor',async()=>{
  const f=speechFixture();const job=queuedSpeechJob();f.seed('transcriptionJob',job);
  const service=new SpeechDurableService(f.repository,(value)=>value);const claim=await service.control(control(job,'claim'));
  await service.control(control(job,'lease',{executionId:claim.executionId,stage:'warming'}));
  assert.ok(f.rows('transcriptionJob')[0].controlHeartbeatAt);
  assert.equal(f.rows('transcriptionJob')[0].engineProgressAt,undefined);
  assert.equal(f.rows('transcriptionJob')[0].progressPercent,undefined);
});

test('finish persiste resultado antes da confirmação e é idempotente após reply perdido',async()=>{
  const f=speechFixture();const job=queuedSpeechJob();f.seed('transcriptionJob',job);
  const service=new SpeechDurableService(f.repository,(value)=>value);const claim=await service.control(control(job,'claim'));
  const request=control(job,'finish',{executionId:claim.executionId,status:'completed',result:completion(job)});
  assert.equal((await service.control(request)).applied,true);
  assert.equal(f.rows('transcriptionJob')[0].status,'completed');assert.equal(f.rows('transcriptionJob')[0].text,completion(job).text);
  assert.equal((await service.control(request)).applied,true);
  assert.equal(f.rows('transcriptionJob')[0].leaseExpiresAt,null);
});

test('resultado de modelo, revisão ou motor diferente termina como falha explícita',async()=>{
  const f=speechFixture();const job=queuedSpeechJob();f.seed('transcriptionJob',job);
  const service=new SpeechDurableService(f.repository,(value)=>value);const claim=await service.control(control(job,'claim'));
  await service.control(control(job,'finish',{executionId:claim.executionId,status:'completed',result:{...completion(job),modelRevision:'outra'}}));
  assert.equal(f.rows('transcriptionJob')[0].status,'failed');assert.equal(f.rows('transcriptionJob')[0].errorCode,'EFFECTIVE_MODEL_MISMATCH');
});

test('lease vencida impede checkpoint e conclusão; deadline absoluto não é estendido por heartbeat',async()=>{
  const f=speechFixture();const job=queuedSpeechJob();f.seed('transcriptionJob',job);
  const service=new SpeechDurableService(f.repository,(value)=>value);const claim=await service.control(control(job,'claim'));
  f.rows('transcriptionJob')[0].leaseExpiresAt=new Date(Date.now()-1);
  assert.equal((await service.control(control(job,'checkpoint',{executionId:claim.executionId,checkpoint:{durationMs:1000,text:'velho'}}))).reason,'LEASE_LOST');
  f.rows('transcriptionJob')[0].deadlineAt=new Date(Date.now()-1);
  assert.equal((await service.control(control(job,'lease',{executionId:claim.executionId}))).reason,'DEADLINE_EXCEEDED');
  assert.equal(f.rows('transcriptionJob')[0].status,'failed');
});

test('checkpoint rejeita fonte cruzada, payload excessivo e regressão',async()=>{
  const f=speechFixture();const job=queuedSpeechJob({checkpoint:{nextChunkIndex:2}});f.seed('transcriptionJob',job);
  const service=new SpeechDurableService(f.repository,(value)=>value);const claim=await service.control(control(job,'claim'));
  for(const checkpoint of [{sourceSha256:'wrong'},{nextChunkIndex:1},{text:'x'.repeat(262145)}]){
    await assert.rejects(service.control(control(job,'checkpoint',{executionId:claim.executionId,checkpoint})),TranscriptionServiceError);
  }
});

test('escopo administrativo não nulo deduplica uploads concorrentes e idempotência não cruza instâncias',async()=>{
  assert.equal(speechScopeKey(null),'admin:global');
  assert.notEqual(speechHash(speechScopeKey('a'),'dictation','key'),speechHash(speechScopeKey('b'),'dictation','key'));
  const f=speechFixture();const service=new SpeechDurableService(f.repository,(value)=>({version:2,jobId:value.id}));
  const data=queuedSpeechJob({dedupKey:speechHash(speechScopeKey(null),'same-audio')});
  const jobs=await Promise.all(Array.from({length:8},()=>service.createJob(data)));
  assert.equal(new Set(jobs.map(job=>job.id)).size,1);assert.equal(f.rows('transcriptionJob').length,1);assert.equal(f.rows('speechOutbox').length,1);
});

test('falha na outbox reverte insert do job na mesma transação (fixture com rollback)',async()=>{
  const f=speechFixture();f.failures['speechOutbox.upsert']=1;
  const service=new SpeechDurableService(f.repository,(value)=>value);
  await assert.rejects(service.createJob(queuedSpeechJob()),/Injected failure/);
  assert.equal(f.rows('transcriptionJob').length,0);assert.equal(f.rows('speechOutbox').length,0);
});

test('quota de pendentes por instância é verificada antes da reserva e reserva não cruza escopo',async()=>{
  const f=speechFixture();for(let index=0;index<5;index++)f.seed('transcriptionJob',queuedSpeechJob({scopeKey:'instance:a'}));
  const service=new SpeechDurableService(f.repository,(value)=>value);
  await assert.rejects(service.reserveUpload('a',1000),(error:any)=>error.status===429);
  const reservation=await service.reserveUpload('b',1000);
  await assert.rejects(service.createJob(queuedSpeechJob({scopeKey:'instance:c',sizeBytes:100}),reservation.id),(error:any)=>error.status===408);
});

test('rejeição de admissão acontece antes de multer anexar leitor ou criar arquivo',async()=>{
  const request:any=new PassThrough();request.headers={'content-type':'multipart/form-data; boundary=abc'};
  request.get=(name:string)=>request.headers[name.toLowerCase()];
  const response:any={headersSent:false,destroyed:false,statusCode:0,set(){return this;},status(value:number){this.statusCode=value;return this;},json(value:any){this.body=value;return this;}};
  await receiveSpeechUpload({reserveUpload:async()=>{throw new TranscriptionServiceError('lotado',429,5);}} as any,'transcription',request,response,async()=>{throw new Error('não deve chegar');});
  assert.equal(response.statusCode,429);assert.equal(request.listenerCount('data'),0);assert.equal(request.file,undefined);
});

test('reserva vencida impede leitura do corpo mesmo quando a admissão atrasou', async () => {
  const request:any = new PassThrough();
  request.headers = {'content-type':'multipart/form-data; boundary=abc'};
  request.get = (name:string) => request.headers[name.toLowerCase()];
  const response:any = {headersSent:false,destroyed:false,statusCode:0,set(){return this;},status(value:number){this.statusCode=value;return this;},json(){return this;}};
  let released = false;
  await receiveSpeechUpload({
    reserveUpload: async () => ({id:'expired',expiresAt:new Date(Date.now()-1)}),
    releaseUpload: async () => {released = true;},
  } as any,'dictation',request,response,async()=>{throw new Error('não deve ler o áudio');});
  assert.equal(response.statusCode,408);
  assert.equal(request.listenerCount('data'),0);
  assert.equal(released,true);
});

test('deduplicação concorrente preserva o registro de fonte redundante até excluir o objeto',async()=>{
  const f = speechFixture();
  const existing = queuedSpeechJob();
  f.seed('transcriptionJob',existing);
  f.seed('speechUploadReservation',{id:'duplicate-upload',poolId:existing.poolId,scopeKey:existing.scopeKey,
    sourceKey:'transcriptions/redundant/audio.ogg',sourceBucket:'private-speech',reservedBytes:1000,
    expiresAt:new Date(Date.now()+60_000)});
  const durable = new SpeechDurableService(f.repository,(job)=>job);
  const duplicate = await durable.createJob({...existing,id:'another-job',sourceKey:'transcriptions/redundant/audio.ogg',sourceBucket:'private-speech'},'duplicate-upload');
  assert.equal(duplicate.id,existing.id);
  assert.equal(f.rows('speechUploadReservation').length,1);
  assert.equal(f.rows('speechOutbox').length,0);
});

test('limpeza pagina após fontes com erro e nunca prende todo o lote nos primeiros objetos',async()=>{
  const f = speechFixture();
  for (const id of ['first','second','third']) f.seed('transcriptionJob',queuedSpeechJob({id,status:'failed',
    sourceKey:'transcriptions/'+id+'/audio.ogg',completedAt:new Date(Date.now()-120_000)}));
  const service:any = new TranscriptionService(f.repository);
  service.sourceStorage = {enabled:()=>true};
  const visited:string[] = [];
  service.removeSourceWithFence = async (id:string) => {visited.push(id);return id === 'third';};
  const first = await service.cleanupExpiredUploads({olderThanSeconds:60,limit:2});
  assert.equal(first.failed,2);
  assert.equal(first.nextCursor,'second');
  const second = await service.cleanupExpiredUploads({olderThanSeconds:60,limit:2,cursor:first.nextCursor});
  assert.equal(second.removed,1);
  assert.equal(second.nextCursor,null);
  assert.deepEqual(visited,['first','second','third']);
});

test('publisher rejeita basic.return mesmo que o broker emita confirmação positiva',async()=>{
  const channel:any=new EventEmitter();
  channel.publish=(_exchange:any,_key:any,_bytes:any,options:any,confirm:any)=>{
    channel.emit('return',{properties:{messageId:options.messageId}});confirm(null);
  };
  await assert.rejects(publishSpeechConfirmed(channel,'exchange','missing',{jobId:'1'}),/SPEECH_UNROUTABLE/);
  assert.equal(channel.listenerCount('return'),0);
});

test('metadados v2 não contêm áudio inline ou base64',()=>{
  const service=new TranscriptionService({} as any);const payload=(service as any).jobPayload(queuedSpeechJob());
  assert.equal(payload.version,2);assert.equal(payload.inlineAudio,undefined);assert.equal(payload.source.sha256,'abc');
  assert.ok(Buffer.byteLength(JSON.stringify(payload))<2048);
});

test('worker vivo e conectado não se declara ready antes de inferência de smoke confirmada',async()=>{
  const f=speechFixture();const service=new SpeechDurableService(f.repository,(value)=>value);const job=queuedSpeechJob();
  await service.control(control(job,'health',{modes:['transcription'],processAlive:true,brokerConnected:true,modelVerified:true,engineReady:true,acceptingJobs:true}));
  assert.equal(f.rows('speechWorker')[0].health.engineReady,false);
  await service.control(control(job,'health',{modes:['transcription'],processAlive:true,brokerConnected:true,modelVerified:true,engineReady:true,acceptingJobs:true,lastSuccessfulInferenceAt:new Date().toISOString()}));
  assert.equal(f.rows('speechWorker')[0].health.engineReady,true);
});

test('fonte usada por job ativo não é removida pela limpeza e tombstone bloqueia retry',async()=>{
  const f=speechFixture();const job=queuedSpeechJob({status:'failed',sourceDeletedAt:new Date()});f.seed('transcriptionJob',job);
  const durable=new SpeechDurableService(f.repository,(value)=>value);
  await assert.rejects(durable.retry(job.id),(error:any)=>error.status===410);
  f.seed('transcriptionJob',queuedSpeechJob({sourceKey:job.sourceKey}));
  const service=new TranscriptionService(f.repository);
  assert.equal(await (service as any).removeSourceWithFence(job.id),false);
});

test('consultas de leitura e lista escopadas carregam filtro obrigatório de posse',async()=>{
  const f=speechFixture();const job=queuedSpeechJob({instanceId:'a'});f.seed('transcriptionJob',job);
  const service=new TranscriptionService(f.repository);
  await assert.rejects(service.get(job.id,'b'),(error:any)=>error.status===404);
  const last=f.queries.at(-1)!;assert.equal(last.args.where.instanceId,'b');
});

test('HTTP conserva multipart administrativo e roteia credencial de instância sem permitir troca de escopo', {timeout:10_000}, async()=>{
  const app=express();app.use(express.json());
  const assigned:any[]=[];const received:any[]=[];
  const service:any={
    reserveUpload:async(_mode:string,instanceId?:string)=>({id:'reservation-'+(instanceId||'global'),expiresAt:new Date(Date.now()+180_000)}),
    reassignAdministrativeUpload:async(id:string,instanceId:string)=>assigned.push({id,instanceId}),
    releaseUpload:async()=>{},resolveInstanceName:async(name:string)=>'instance-'+name,
    enqueueUpload:async(input:any)=>{assert.ok(input.filePath);assert.equal(input.buffer,undefined);assert.equal((await stat(input.filePath)).size,5);received.push(input);return {id:'job',mode:'transcription',status:'queued'};},
    get:async(id:string,instanceId:string)=>{if(id!=='owned-'+instanceId)throw new TranscriptionServiceError('Não encontrado',404);return {id,mode:'transcription'};},
  };
  const guard:any=(req:any,res:any,next:any)=>{
    const expected=req.params.instanceName?'key-'+req.params.instanceName:'global-key';
    if(req.get('apikey')!==expected){res.status(401).json({error:'unauthorized'});return;}next();
  };
  app.use('/v1/speech/instances/:instanceName',new SpeechRouter(service,guard).router);
  app.use('/v1/speech',new SpeechRouter(service,guard).router);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const address=server.address() as any;const base='http://127.0.0.1:'+address.port;
  try{
    const form=new FormData();form.append('instanceId','instance-a');form.append('audio',new Blob(['audio'],{type:'audio/ogg'}),'audio.ogg');
    const uploaded=await fetch(base+'/v1/speech/transcriptions/upload',{method:'POST',headers:{apikey:'global-key'},body:form});
    assert.equal(uploaded.status,202);assert.equal(assigned[0].instanceId,'instance-a');assert.equal(received[0].instanceId,'instance-a');
    const owned=await fetch(base+'/v1/speech/instances/a/transcriptions/owned-instance-a',{headers:{apikey:'key-a','X-Speech-Instance-Id':'instance-b'}});
    assert.equal(owned.status,200);
    const another=await fetch(base+'/v1/speech/instances/a/transcriptions/owned-instance-b',{headers:{apikey:'key-a'}});assert.equal(another.status,404);
    const wrongKey=await fetch(base+'/v1/speech/instances/b/transcriptions/owned-instance-b',{headers:{apikey:'key-a'}});assert.equal(wrongKey.status,401);
  }finally{server.closeAllConnections();await new Promise<void>((resolve)=>server.close(()=>resolve()));}
});

test('health distingue revisão instalada e modo desabilitado sem bloquear aceitação fria válida', async()=>{
  const before=process.env.SPEECH_ENABLED;const previousDictation=process.env.DICTATION_ENABLED;
  process.env.SPEECH_ENABLED='true';process.env.DICTATION_ENABLED='false';
  try{
    const model=getConfiguredSpeechModel()!;const f=speechFixture();
    f.seed('speechWorker',{id:'worker',poolId:queuedSpeechJob().poolId,heartbeatAt:new Date(),modes:['dictation','transcription'],health:{
      effectiveModel:model.id,engine:model.engine,modelRevision:'wrong-revision',processAlive:true,brokerConnected:true,
      modelVerified:true,engineReady:false,acceptingJobs:true,
    }});
    const service=new TranscriptionService(f.repository);Object.assign(service,{connection:{},channel:{},resultChannel:{}});
    service.init=async()=>{};service.modelDownloadStatus=async()=>({installed:true}) as any;
    assert.equal((await service.health()).capabilities.transcription,false);
    f.rows('speechWorker')[0].health.modelRevision=model.revision;
    const cold=await service.health();assert.equal(cold.capabilities.transcription,true);assert.equal(cold.workerReady,false);
    assert.equal(cold.dictationWorkerReady,false);assert.equal(cold.capabilities.dictation,false);
    f.rows('speechWorker')[0].health.engineReady=true;
    assert.equal((await service.health()).workerReady,true);
  }finally{
    if(before===undefined)delete process.env.SPEECH_ENABLED;else process.env.SPEECH_ENABLED=before;
    if(previousDictation===undefined)delete process.env.DICTATION_ENABLED;else process.env.DICTATION_ENABLED=previousDictation;
  }
});

test('limite agregado de bytes pendentes rejeita antes do insert/outbox',async()=>{
  const previous=process.env.SPEECH_MAX_PENDING_AUDIO_BYTES;process.env.SPEECH_MAX_PENDING_AUDIO_BYTES='1024';
  try{
    const f=speechFixture();const service=new SpeechDurableService(f.repository,(value)=>value);
    await assert.rejects(service.createJob(queuedSpeechJob({reservedBytes:2048,sizeBytes:2048})),(error:any)=>error.status===429);
    assert.equal(f.rows('transcriptionJob').length,0);assert.equal(f.rows('speechOutbox').length,0);
  }finally{if(previous===undefined)delete process.env.SPEECH_MAX_PENDING_AUDIO_BYTES;else process.env.SPEECH_MAX_PENDING_AUDIO_BYTES=previous;}
});

test('mesma Idempotency-Key com outro conteúdo é conflito identificável',async()=>{
  const f=speechFixture();const service=new SpeechDurableService(f.repository,(value)=>value);
  const job=queuedSpeechJob({dedupKey:'audio-a',idempotencyHash:'same-key'});f.seed('transcriptionJob',job);
  await assert.rejects(service.createJob(queuedSpeechJob({dedupKey:'audio-b',idempotencyHash:'same-key'})),(error:any)=>error.status===409);
  assert.equal(f.rows('transcriptionJob').length,1);
});
