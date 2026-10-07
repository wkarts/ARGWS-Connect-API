const date = { type: ['string', 'null'], format: 'date-time' };
const text = { type: ['string', 'null'] };
const retryHeaders = {
  'Retry-After': { description: 'Espera sugerida, em segundos.', schema: { type: 'integer', minimum: 1 } },
};
const jobContent = { 'application/json': { schema: { $ref: '#/components/schemas/TranscriptionJob' } } };
const healthContent = { 'application/json': { schema: { $ref: '#/components/schemas/SpeechHealth' } } };
const failures = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { description: 'A credencial não autoriza este escopo ou operação administrativa.' },
  404: { $ref: '#/components/responses/NotFound' },
  409: { description: 'Recurso desabilitado, modelo incompatível ou execução em conflito.' },
  429: { description: 'Limite de trabalhos, bytes, duração ou uploads atingido.', headers: retryHeaders },
  503: { description: 'Controle, banco, armazenamento ou pool de fala indisponível.', headers: retryHeaders },
};
const uploadParameters = [
  {
    name: 'X-Speech-Instance-Id',
    in: 'header',
    description:
      'No caminho administrativo, reserva a cota da instância antes do corpo. A rota escopada já determina a instância.',
    schema: { type: 'string' },
  },
  {
    name: 'Idempotency-Key',
    in: 'header',
    description: 'Chave da mesma operação lógica, isolada por escopo e modo.',
    schema: { type: 'string', maxLength: 128 },
  },
];
const audio = {
  type: 'object',
  required: ['audio'],
  properties: {
    audio: { type: 'string', format: 'binary' },
    language: { type: 'string', example: 'pt-BR' },
    model: {
      type: 'string',
      description: 'Deve corresponder ao modelo configurado; não seleciona fallback.',
      example: 'whisper-base-q5_1',
    },
    instanceId: {
      type: 'string',
      description: 'Campo administrativo legado. Uma instância determinada pela rota/header não pode ser substituída.',
    },
    idempotencyKey: { type: 'string', maxLength: 128 },
  },
};
const multipart = { 'multipart/form-data': { schema: audio } };
const accepted = {
  202: { description: 'Job e outbox persistidos. O processamento pode aguardar na fila.', content: jobContent },
  ...failures,
  408: { description: 'Upload ou reserva de recepção expirou.' },
  413: { description: 'Áudio ou corpo de metadados excede o limite.' },
  415: { description: 'Formato não suportado; arquivos usam multipart/form-data.' },
};
const uploadDescription =
  'Recebe áudio em arquivo temporário com prazo e reserva durável antes do corpo; grava a fonte em armazenamento privado e publica somente metadados pelo protocolo v2. JSON de metadados é limitado a 64 KiB. Não há áudio base64 na fila.';
const cancelDescription =
  'Registra cancelamento no banco. O worker encerra o grupo do motor; a capacidade e a exclusão da fonte aguardam confirmação ou expiração segura da lease. Resultados de execuções antigas são rejeitados.';
const retryDescription =
  'Repete uma transcrição elegível com fonte ainda disponível, nova geração e prazo. Job ativo ou lease ainda vigente retorna 409. Fonte expirada retorna 410. Para protocolo legado, verifica fonte e ausência de consumidores antigos antes da promoção controlada para v2.';

export const speechJobSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'model', 'status', 'attempts', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    workerId: text,
    messageId: text,
    instanceId: text,
    mode: { type: 'string', enum: ['transcription', 'dictation'] },
    sourceType: { type: 'string' },
    originalFilename: text,
    sizeBytes: { type: ['integer', 'null'], minimum: 0 },
    audioHash: text,
    provider: { type: 'string', example: 'local' },
    model: { type: 'string' },
    requestedModel: text,
    effectiveModel: text,
    engine: { type: ['string', 'null'], enum: ['transformers', 'whisper.cpp', null] },
    modelRevision: text,
    language: text,
    status: { type: 'string', enum: ['queued', 'processing', 'completed', 'cancelled', 'failed'] },
    stage: {
      type: 'string',
      description: 'Etapa real, como queued, loading_model, transcribing, yielded, retrying ou estado terminal.',
    },
    progressPercent: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: 'Somente interpretar como percentual quando durationKnown=true; 100 na conclusão.',
    },
    processedDurationMs: { type: 'integer', minimum: 0 },
    durationKnown: { type: 'boolean' },
    heartbeatAt: date,
    controlHeartbeatAt: date,
    engineProgressAt: date,
    generation: { type: 'integer', minimum: 1 },
    leaseExpiresAt: date,
    deadlineAt: date,
    cancelRequestedAt: date,
    queueWaitMs: { type: 'integer', minimum: 0 },
    text,
    detectedLanguage: text,
    durationMs: { type: ['integer', 'null'], minimum: 0 },
    segments: { type: ['array', 'null'], items: { type: 'object', additionalProperties: true } },
    errorCode: text,
    errorMessage: text,
    attempts: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: date,
    completedAt: date,
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const speechHealthSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    enabled: { type: 'boolean' },
    poolId: { type: 'string' },
    protocolVersion: { const: 2 },
    connected: { type: 'boolean' },
    processAlive: { type: 'boolean' },
    brokerConnected: { type: 'boolean' },
    modelVerified: { type: 'boolean' },
    engineReady: { type: 'boolean' },
    acceptingJobs: { type: 'boolean' },
    workerReady: { type: 'boolean' },
    dictationWorkerReady: { type: 'boolean' },
    lastSuccessfulInferenceAt: date,
    state: { type: 'string', description: 'disabled, offline, warming, ready, busy, capacity_exhausted ou degraded.' },
    model: text,
    engine: text,
    provider: { type: 'string' },
    queue: { type: 'string' },
    dictationQueue: { type: 'string' },
    consumerCount: { type: 'integer', minimum: 0 },
    dictationConsumerCount: { type: 'integer', minimum: 0 },
    queuedJobs: { type: 'integer', minimum: 0 },
    processingJobs: { type: 'integer', minimum: 0 },
    dictationQueuedJobs: { type: 'integer', minimum: 0 },
    dictationProcessingJobs: { type: 'integer', minimum: 0 },
    oldestQueuedSeconds: { type: ['integer', 'null'], minimum: 0 },
    capabilities: {
      type: 'object',
      properties: { dictation: { type: 'boolean' }, transcription: { type: 'boolean' } },
    },
    modelDownload: { type: 'object', additionalProperties: true },
  },
};

const operations = {
  'GET /live': {
    summary: 'Verificar liveness de voz',
    description: 'Confirma o processo HTTP; não comprova o motor.',
    responses: { 200: { description: 'API viva.' }, 401: failures['401'] },
  },
  'GET /health': {
    summary: 'Consultar saúde do pool de fala',
    description:
      'Distingue supervisor, broker, arquivos verificados, prontidão do motor, capacidade e última inferência real. Pool frio pode aceitar trabalho para carregar o modelo.',
    responses: {
      200: { description: 'Diagnóstico do pool; contagens respeitam o escopo.', content: healthContent },
      ...failures,
    },
  },
  'GET /ready': {
    summary: 'Verificar prontidão real de fala',
    description:
      'Exige modelo/revisão compatíveis, heartbeat recente e reconhecimento inicial concluído. Consumidor registrado não basta. all exige todos os modos habilitados; um pool frio retorna 503 até atender o primeiro trabalho.',
    parameters: [
      {
        name: 'mode',
        in: 'query',
        schema: { type: 'string', enum: ['all', 'transcription', 'dictation'], default: 'all' },
      },
    ],
    responses: { 200: { description: 'Motor pronto no modo solicitado.', content: healthContent }, ...failures },
  },
  'GET /models': {
    summary: 'Consultar modelo configurado',
    description:
      'Informa revisão, instalação, verificação e progresso. Estados: unavailable, not_installed, verifying, downloading, ready, failed. Catálogo permitido em scripts/speech-models.json.',
    responses: { 200: { description: 'Modelo configurado e estado de provisionamento.' }, ...failures },
  },
  'POST /models/{modelId}/download': {
    summary: 'Provisionar ou reparar modelo local',
    description:
      'Administrativo. Baixa somente o modelo configurado, em revisão fixada. SHA-256 e transferência rodam em processo supervisionado. force=true refaz os arquivos. Download no startup só com SPEECH_MODEL_AUTO_PROVISION=true. Identificador com barra deve ser codificado no segmento da URL.',
    requestBody: {
      required: false,
      content: {
        'application/json': { schema: { type: 'object', properties: { force: { type: 'boolean', default: false } } } },
      },
    },
    responses: {
      200: { description: 'Modelo instalado e verificado.' },
      202: { description: 'Download ou verificação em andamento.' },
      ...failures,
    },
  },
  'POST /models/{modelId}/activate': {
    summary: 'Confirmar modelo configurado',
    description:
      'Administrativo. Não troca o motor em execução. Para mudar, drene jobs, provisione, alinhe SPEECH_ENGINE/SPEECH_MODEL/SPEECH_MODEL_PATH e reinicie o pool.',
    responses: {
      200: { description: 'Modelo configurado confirmado; readiness informa se está operacional.' },
      ...failures,
    },
  },
  'POST /dictation': {
    summary: 'Criar ditado',
    description: uploadDescription,
    parameters: uploadParameters,
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            ...audio,
            properties: {
              ...audio.properties,
              durationMs: {
                type: 'integer',
                minimum: 0,
                description: 'Duração declarada; o processamento aplica o limite real.',
              },
            },
          },
        },
      },
    },
    responses: {
      ...accepted,
      202: {
        description: 'Ditado aceito; consultar o ID até estado terminal.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['id', 'status', 'mode'],
              properties: { id: { type: 'string' }, status: { type: 'string' }, mode: { const: 'dictation' } },
            },
          },
        },
      },
    },
  },
  'GET /dictation/{jobId}': {
    summary: 'Consultar ditado',
    description: 'Estado, duração processada e texto persistidos.',
    responses: { 200: { description: 'Job de ditado.', content: jobContent }, ...failures },
  },
  'POST /dictation/{jobId}/cancel': {
    summary: 'Cancelar ditado',
    description: cancelDescription,
    responses: { 200: { description: 'Estado persistido.', content: jobContent }, ...failures },
  },
  'GET /transcriptions': {
    summary: 'Listar transcrições',
    description: 'Lista recente limitada ao escopo autenticado.',
    parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 } }],
    responses: {
      200: {
        description: 'Jobs recentes.',
        content: {
          'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TranscriptionJob' } } },
        },
      },
      ...failures,
    },
  },
  'POST /transcriptions': {
    summary: 'Criar transcrição de mensagem ou upload',
    description: uploadDescription + ' JSON com messageId reutiliza a mídia da mensagem autenticada.',
    parameters: uploadParameters,
    requestBody: {
      required: true,
      content: {
        ...multipart,
        'application/json': {
          schema: {
            type: 'object',
            required: ['messageId'],
            properties: {
              messageId: { type: 'string', minLength: 1 },
              instanceId: { type: 'string' },
              model: audio.properties.model,
              language: audio.properties.language,
              idempotencyKey: audio.properties.idempotencyKey,
            },
          },
        },
      },
    },
    responses: accepted,
  },
  'POST /transcriptions/upload': {
    summary: 'Enviar áudio para transcrição',
    description: uploadDescription,
    parameters: uploadParameters,
    requestBody: { required: true, content: multipart },
    responses: accepted,
  },
  'GET /transcriptions/{jobId}': {
    summary: 'Consultar transcrição',
    description: 'Duração, heartbeat de controle, progresso do motor, geração, prazo e resultado persistidos.',
    responses: { 200: { description: 'Job de transcrição.', content: jobContent }, ...failures },
  },
  'POST /transcriptions/{jobId}/cancel': {
    summary: 'Cancelar transcrição',
    description: cancelDescription,
    responses: { 200: { description: 'Estado persistido.', content: jobContent }, ...failures },
  },
  'POST /transcriptions/{jobId}/retry': {
    summary: 'Repetir transcrição elegível',
    description: retryDescription,
    responses: {
      202: { description: 'Nova execução aceita.', content: jobContent },
      ...failures,
      410: { description: 'Fonte expirou; envie outro áudio.' },
    },
  },
  'DELETE /transcriptions/{jobId}': {
    summary: 'Excluir transcrição',
    description:
      'Cancela trabalho ativo e aguarda encerramento da lease antes de excluir. Remove fonte de upload própria; preserva mídia original de mensagem.',
    responses: { 200: { description: 'Job removido; resposta informa sourceRemoved e sourceRetained.' }, ...failures },
  },
};

export const speechOperations = {};
for (const [key, operation] of Object.entries(operations)) {
  const [method, suffix] = key.split(' ');
  for (const scoped of [false, true]) {
    const prefix = scoped ? '/v1/speech/instances/{instanceName}' : '/v1/speech';
    speechOperations[method + ' ' + prefix + suffix] = {
      ...operation,
      tags: ['Speech'],
      description:
        operation.description +
        (scoped
          ? ' A chave deve autorizar a instância da rota; operações de modelo exigem chave administrativa.'
          : ' Exige chave administrativa global.'),
    };
  }
}
export const legacySpeechOperations = {
  'GET /v1/transcriptions/health': speechOperations['GET /v1/speech/health'],
  'POST /v1/transcriptions/upload': speechOperations['POST /v1/speech/transcriptions/upload'],
  'POST /v1/transcriptions/{jobId}/cancel': speechOperations['POST /v1/speech/transcriptions/{jobId}/cancel'],
  'POST /v1/transcriptions/{jobId}/retry': speechOperations['POST /v1/speech/transcriptions/{jobId}/retry'],
};
