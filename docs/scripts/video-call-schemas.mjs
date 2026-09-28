const json = schema => ({ 'application/json': { schema } });
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const mediaProperties = {
  codec: { type: 'string', const: 'h264' }, format: { type: 'string', const: 'annexb' },
  mediaPath: { type: 'string', const: '/video/media' },
  maxFrameBytes: { type: 'integer', minimum: 1024, maximum: 8388608 },
  maxFps: { type: 'integer', minimum: 1, maximum: 30 },
  width: { type: 'integer', minimum: 160, maximum: 1280 },
  height: { type: 'integer', minimum: 120, maximum: 720 },
  bitrate: { type: 'integer', minimum: 100000, maximum: 4000000 },
};
export const videoCallSchemas = {
  VideoMediaConfiguration: { type: 'object', required: Object.keys(mediaProperties), properties: mediaProperties },
  CallCapabilities: {
    type: 'object', required: ['audio', 'video', 'engine'],
    properties: {
      audio: { type: 'boolean' }, video: { type: 'boolean' }, engine: { type: 'string' },
      videoCodec: { type: 'string', const: 'h264' }, videoMedia: ref('VideoMediaConfiguration'),
    },
  },
  VideoMediaTicket: {
    type: 'object', required: ['ticket', 'expiresAt', 'expiresInSeconds', ...Object.keys(mediaProperties)],
    properties: {
      ticket: { type: 'string', description: 'Segredo efêmero de uso único. Nunca colocar na URL ou em logs.' },
      expiresAt: { type: 'string', format: 'date-time' }, expiresInSeconds: { type: 'integer', const: 30 },
      ...mediaProperties,
    },
  },
};
export const videoCallOperations = {
  'GET /call/capabilities/{instanceName}': {
    summary: 'Consultar capacidade efetiva de chamadas',
    description: 'Retorna o suporte da instância em execução. Vídeo exige Connect Video Adapter habilitado; voz continua no plugin validado. O nome do provider sozinho não comprova suporte a vídeo.',
    responses: { '200': { description: 'Capacidades em execução, sem cache.', content: json(ref('CallCapabilities')) } },
  },
  'POST /call/videoMediaTicket/{instanceName}': {
    summary: 'Emitir ticket descartável para mídia de vídeo',
    description: 'Exige autenticação e acesso à instância, chamada isVideo existente e não terminada. Ticket vinculado à instância, chamada e runtime, válido por 30s e consumido uma única vez. Conecte a /video/media e envie {ticket} no primeiro frame JSON; depois, aguarde ready e use o protocolo binário CV. Não transmite vídeo por webhook.',
    requestBody: { required: true, content: json({ type: 'object', required: ['callId'], properties: { callId: { type: 'string', minLength: 1 } } }) },
    responses: {
      '201': { description: 'Ticket criado; Cache-Control: no-store.', content: json(ref('VideoMediaTicket')) },
      '400': { description: 'Vídeo indisponível, limite de tickets ou entrada inválida.' },
      '404': { description: 'Instância ou chamada de vídeo ativa não encontrada.' },
    },
  },
  'POST /call/offer/{instanceName}': {
    summary: 'Iniciar chamada de voz ou vídeo',
    description: 'Preserva o contrato existente. isVideo ausente/false utiliza o plugin de voz homologado; true utiliza o adapter de vídeo quando a capability efetiva está disponível. A resposta confirma envio da oferta, não atendimento remoto. Acompanhe CALL/list para o estado.',
    requestBody: { required: true, content: json({ type: 'object', required: ['number'], properties: {
      number: { type: 'string' }, isVideo: { type: 'boolean', default: false },
      callDuration: { type: 'number', description: 'Tempo opcional para encerramento automático em segundos.' },
    } }) },
  },
};
