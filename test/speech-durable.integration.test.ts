import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { SpeechDurableService } from '@api/services/speech-durable.service';
import { publishSpeechConfirmed, speechDeadLetterArguments, speechQueue, speechQueueArguments, speechRequestRoutingKey } from '@api/services/speech-policy';
import { TranscriptionService } from '@api/services/transcription.service';
import { PrismaClient } from '@prisma/client';
import * as amqp from 'amqplib';

const databaseUrl = process.env.SPEECH_TEST_DATABASE_URL;
const rabbitUri = process.env.SPEECH_TEST_RABBITMQ_URI;

// CI supplies a disposable PostgreSQL/MySQL schema and RabbitMQ. No mocked storage in this suite.
test('integração SQL real + RabbitMQ: atomicidade, fencing, publish/return e cancelamento', {
  skip: !databaseUrl || !rabbitUri ? 'Requer SPEECH_TEST_DATABASE_URL e SPEECH_TEST_RABBITMQ_URI; fixtures não comprovam SQL/AMQP.' : false,
  timeout: 120_000,
}, async (context) => {
  const poolId = 'speech-integration-' + randomUUID();
  process.env.SPEECH_POOL_ID = poolId;
  process.env.RABBITMQ_EXCHANGE_NAME = poolId;
  process.env.SPEECH_TRANSCRIPTION_QUEUE = poolId + '.transcription';
  process.env.SPEECH_DICTATION_QUEUE = poolId + '.dictation';
  process.env.SPEECH_GLOBAL_CONCURRENCY = '1';
  process.env.SPEECH_MAX_PENDING_JOBS = '50';
  process.env.SPEECH_MAX_PENDING_JOBS_PER_INSTANCE = '5';
  const database: any = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
  const connection = await amqp.connect(rabbitUri!);
  const channel = await connection.createConfirmChannel();
  const durable = new SpeechDurableService(database, (job) => ({ version: 2, jobId: job.id, poolId,
    generation: job.generation, mode: job.mode, source: { key: job.sourceKey, bytes: job.sizeBytes, sha256: job.audioHash } }));
  const jobData = (extra: any = {}) => ({ id: randomUUID(), scopeKey: 'admin:global', instanceId: null, mode: 'transcription',
    dedupKey: randomUUID().replaceAll('-',''), sourceKey: 'transcriptions/integration/audio.ogg', sourceMimeType: 'audio/ogg',
    sourceType: 'upload', model: 'Xenova/whisper-small', requestedModel: 'Xenova/whisper-small',
    requestedEngine: 'transformers', requestedRevision: 'test-revision', provider: 'local',
    audioHash: 'ab'.repeat(32), sizeBytes: 1000, reservedBytes: 1000, reservedDurationMs: 60_000, ...extra });
  const control = (job: any, action: string, extra: any = {}) => ({ version: 2, poolId, jobId: job.id,
    generation: job.generation, workerId: 'integration-worker', action, ...extra });
  const cleanup = async () => {
    await database.speechOutbox.deleteMany({ where: { poolId } });
    await database.transcriptionJob.deleteMany({ where: { poolId } });
    await database.speechUploadReservation.deleteMany({ where: { poolId } });
  };
  try {
    await database.$connect();
    await channel.assertExchange(poolId,'topic',{durable:true});
    for (const mode of ['transcription','dictation']) {
      await channel.assertQueue(speechQueue(mode)+'.dead-letter',{durable:true,arguments:speechDeadLetterArguments()});
      await channel.assertQueue(speechQueue(mode),{durable:true,arguments:speechQueueArguments(mode)});
      await channel.bindQueue(speechQueue(mode),poolId,speechRequestRoutingKey(mode));
    }

    await context.test('SQL reverte job quando outbox falha após o insert',async()=>{
      const id=randomUUID();const failing=new SpeechDurableService(database,()=>({unsupported:1n}));
      await assert.rejects(failing.createJob(jobData({id})));
      assert.equal(await database.transcriptionJob.count({where:{id}}),0);
      assert.equal(await database.speechOutbox.count({where:{jobId:id}}),0);
    });

    await context.test('SQL deduplica concorrência administrativa com índice não nulo',async()=>{
      const data=jobData();
      const results=await Promise.all(Array.from({length:4},()=>durable.createJob(data)));
      assert.equal(new Set(results.map(job=>job.id)).size,1);
      assert.equal(await database.transcriptionJob.count({where:{poolId}}),1);
      assert.equal(await database.speechOutbox.count({where:{jobId:data.id}}),1);
      await cleanup();
    });

    await context.test('SQL claim concorrente concede uma execução e cerca duplicatas',async()=>{
      const job=await durable.createJob(jobData());
      const claims=await Promise.all(Array.from({length:4},(_,index)=>durable.control(control(job,'claim',{workerId:'worker-'+index}))));
      assert.equal(claims.filter(claim=>claim.granted).length,1);
      const current=await database.transcriptionJob.findUnique({where:{id:job.id}});
      const cancelled=await durable.cancel(job.id);assert.equal(cancelled.status,'cancelled');
      const stale=await durable.control(control(job,'finish',{workerId:current.workerId,executionId:current.executionId,status:'completed',result:{text:'late'}}));
      assert.equal(stale.applied,true);
      assert.equal((await database.transcriptionJob.findUnique({where:{id:job.id}})).status,'cancelled');
      const duplicate=await durable.control(control(job,'claim'));assert.equal(duplicate.granted,false);
      await cleanup();
    });

    await context.test('reserva de upload impõe quota entre coordenadores SQL concorrentes',async()=>{
      const results=await Promise.allSettled(Array.from({length:4},()=>durable.reserveUpload(undefined,26_214_400)));
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(await database.speechUploadReservation.count({where:{poolId}}),1);
      await cleanup();
    });

    await context.test('confirm de exchange sem binding é rejected por basic.return real',async()=>{
      await assert.rejects(publishSpeechConfirmed(channel,poolId,'route.missing',{jobId:randomUUID()}),/SPEECH_UNROUTABLE/);
    });

    await context.test('outbox sobrevive restart do publicador e confirmação só marca rota durável',async()=>{
      const job=await durable.createJob(jobData());
      const runtime=new TranscriptionService(database);
      (runtime as any).channel=channel;
      await (runtime as any).dispatchOutbox();
      const persisted=await database.speechOutbox.findUnique({where:{jobId_generation:{jobId:job.id,generation:1}}});
      assert.equal(persisted.status,'published');
      const message=await channel.get(speechQueue('transcription'),{noAck:false});
      assert.ok(message);if(!message)return;
      const payload=JSON.parse(message.content.toString());assert.equal(payload.version,2);assert.equal(payload.jobId,job.id);assert.equal(payload.inlineAudio,undefined);
      channel.nack(message,false,true);
      const restarted=new TranscriptionService(database);(restarted as any).channel=channel;
      await (restarted as any).dispatchOutbox();
      const redelivery=await channel.get(speechQueue('transcription'),{noAck:false});assert.ok(redelivery);if(redelivery)channel.ack(redelivery);
      await cleanup();
    });

    await context.test('checkpoint SQL atravessa nova geração e resultado antigo não modifica texto',async()=>{
      const job=await durable.createJob(jobData());const first=await durable.control(control(job,'claim'));
      await durable.control(control(job,'release',{executionId:first.executionId,reason:'yield',checkpoint:{nextChunkIndex:1,durationMs:30000,processedDurationMs:30000,offsetSamples:480000,durationKnown:false,text:'persistido',sourceSha256:job.audioHash}}));
      const resumed=await database.transcriptionJob.findUnique({where:{id:job.id}});assert.equal(resumed.generation,2);assert.equal(resumed.checkpoint.text,'persistido');
      const second=await durable.control(control(resumed,'claim'));assert.notEqual(second.executionId,first.executionId);
      const old=await durable.control(control(job,'finish',{executionId:first.executionId,status:'completed',result:{text:'velho'}}));
      assert.equal(old.reason,'STALE_GENERATION');assert.equal((await database.transcriptionJob.findUnique({where:{id:job.id}})).text,'persistido');
      await cleanup();
    });
  } finally {
    await cleanup();
    await database.speechWorker.deleteMany({where:{poolId}});
    await database.speechPool.deleteMany({where:{id:poolId}});
    for(const mode of ['transcription','dictation']) { await channel.deleteQueue(speechQueue(mode));await channel.deleteQueue(speechQueue(mode)+'.dead-letter'); }
    await channel.deleteExchange(poolId);await channel.close();await connection.close();await database.$disconnect();
  }
});
