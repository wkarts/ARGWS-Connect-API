/** Public schemas follow findhub.schema.ts, FindHubRouter and its services. */
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: 'string' };
const secret = { type: 'string', minLength: 1, writeOnly: true };
const timestamp = { type: 'string', format: 'date-time' };
const body = (name, example) => ({ required: true, content: { 'application/json': { schema: ref(name), ...(example ? { example } : {}) } } });
const errors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '404': { $ref: '#/components/responses/NotFound' },
  default: { description: 'Erro de configuração, autenticação, transporte Google ou integração. A aprovação de CI não garante disponibilidade do protocolo privado.', content: { 'application/json': { schema: ref('ErrorResponse') } } },
};
const response = (schema, description, status = '200') => ({
  [status]: { description, content: { 'application/json': { schema } } }, ...errors,
});
const operation = (summary, description, schema, extras = {}) => ({
  tags: ['Google Find Hub'], summary, description, requestBody: undefined,
  responses: response(schema, summary), ...extras,
});

export const findHubSchemas = {
  FindHubAuthStartRequest: {
    type: 'object', additionalProperties: false, required: ['email'],
    properties: { email: { type: 'string', minLength: 3, description: 'Conta Google de propriedade do operador autorizado.' } },
  },
  FindHubAuthSession: {
    type: 'object', required: ['sessionId', 'bridgeToken', 'state', 'authMode', 'expiresAt'],
    properties: {
      sessionId: text,
      bridgeToken: { type: 'string', description: 'Segredo temporário da vinculação; não registrar em logs, URL ou webhook.' },
      state: { const: 'WAITING_AUTH' }, authMode: { const: 'credential-provider' }, expiresAt: timestamp,
    },
  },
  FindHubCredentialBundleRequest: {
    type: 'object', additionalProperties: false,
    required: ['sessionId', 'bridgeToken', 'email', 'androidId', 'accountToken', 'sharedKey'],
    properties: {
      sessionId: { type: 'string', minLength: 1 }, bridgeToken: secret,
      email: { type: 'string', minLength: 3 }, androidId: { type: 'string', minLength: 1 },
      accountToken: { ...secret, description: 'Token AAS previamente obtido por um CredentialProvider compatível. Não é senha Google, API key do Cloud Console ou access_token OAuth público.' },
      sharedKey: { ...secret, description: 'Chave autorizada do domínio de segurança Find Hub, hexadecimal ou base64. Não confundir com FINDHUB_CREDENTIALS_KEY, que pertence exclusivamente ao servidor.' },
      fcm: { type: 'object', writeOnly: true, additionalProperties: true, description: 'Estado FCM opcional, fornecido pelo CredentialProvider; material sensível.' },
    },
  },
  FindHubAuthResult: { type: 'object', required: ['state', 'email'], properties: { state: { const: 'READY' }, email: text } },
  FindHubAuthStatus: {
    type: 'object', required: ['state', 'email', 'ready'],
    properties: { state: text, email: { type: ['string', 'null'] }, ready: { type: 'boolean', description: 'Indica credenciais persistidas; não comprova sozinho a disponibilidade de localização no Google.' } },
  },
  FindHubDevice: {
    type: 'object', required: ['id', 'googleDeviceId', 'name', 'identifierType', 'deviceType'],
    properties: {
      id: { type: 'string', description: 'ID local usado no parâmetro deviceId das rotas; sempre isolado pela instância.' },
      googleDeviceId: text, name: text,
      identifierType: { type: 'string', enum: ['ANDROID', 'SPOT', 'UNKNOWN'] },
      deviceType: { type: 'string', enum: ['PHONE', 'TABLET', 'WATCH', 'HEADPHONES', 'EARBUDS', 'TRACKER', 'UNKNOWN'] },
      manufacturer: text, model: text, imageUrl: text, trackingEnabled: { type: 'boolean' },
      trackingIntervalSeconds: { type: 'integer' }, lastLocationAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  FindHubPosition: {
    type: 'object', required: ['deviceId', 'googleDeviceId', 'latitude', 'longitude', 'timestamp', 'source', 'ownReport'],
    properties: {
      deviceId: text, googleDeviceId: text, latitude: { type: 'number' }, longitude: { type: 'number' },
      altitude: { type: 'number' }, accuracy: { type: 'number' }, timestamp,
      source: { type: 'string', enum: ['RECENT', 'NETWORK', 'LAST_KNOWN', 'CROWDSOURCED', 'AGGREGATED', 'UNKNOWN'] },
      semanticLocation: text, ownReport: { type: 'boolean' },
    },
  },
  FindHubStoredPosition: {
    type: 'object', additionalProperties: true,
    properties: { id: text, instanceId: text, deviceId: text, latitude: { type: 'number' }, longitude: { type: 'number' }, altitude: { type: ['number', 'null'] }, accuracy: { type: ['number', 'null'] }, source: text, ownReport: { type: 'boolean' }, semanticLocation: { type: ['string', 'null'] }, recordedAt: timestamp },
  },
  FindHubTrackingRequest: {
    type: 'object', additionalProperties: false,
    properties: { intervalSeconds: { type: 'integer', minimum: 0, maximum: 86400, description: '0 agenda a próxima consulta após concluir a atual, sem paralelismo. 1, 2 ou mais segundos são aceitos; 60 é recomendação, não limite. Falhas usam recuo progressivo.' } },
  },
  FindHubTrackingResult: { type: 'object', required: ['deviceId', 'enabled'], properties: { deviceId: text, enabled: { type: 'boolean' }, intervalSeconds: { type: 'integer' } } },
  FindHubTraccarRequest: {
    type: 'object', additionalProperties: false, required: ['enabled', 'url', 'deviceId'],
    properties: { enabled: { type: 'boolean' }, url: { type: 'string', minLength: 1, description: 'Endpoint HTTP/OsmAnd acessível a partir da API; não é o endpoint REST /api do Traccar.' }, deviceId: { type: 'string', minLength: 1, description: 'Identificador do dispositivo cadastrado no Traccar.' } },
  },
  FindHubTraccarBinding: {
    type: 'object', additionalProperties: true,
    properties: { id: text, instanceId: text, deviceId: text, enabled: { type: 'boolean' }, url: text, traccarDeviceId: text },
  },
};

export const findHubOperations = {
  'POST /findhub/auth/start/{instanceName}': operation('Iniciar vinculação da conta Google', 'Cria sessão de dez minutos e devolve bridgeToken sensível. Não devolve URL OAuth, QR Code ou callback Google: o CredentialProvider externo precisa obter o bundle autorizado.', ref('FindHubAuthSession'), { requestBody: body('FindHubAuthStartRequest', { email: 'operador@example.com' }), responses: response(ref('FindHubAuthSession'), 'Sessão temporária criada; aguarda o CredentialProvider.', '201') }),
  'POST /findhub/auth/import/{instanceName}': operation('Importar bundle autorizado e conectar', 'Exige apikey da instância, sessionId e bridgeToken. Cifra o bundle com FINDHUB_CREDENTIALS_KEY e tenta conectar o canal. Não recebe senha, cookies do navegador nem a chave de criptografia do servidor. Um login comum no Google não produz automaticamente esse bundle.', ref('FindHubAuthResult'), { requestBody: body('FindHubCredentialBundleRequest') }),
  'GET /findhub/auth/status/{instanceName}': operation('Consultar estado da autenticação', 'Consulta estado persistido sem devolver tokens nem chaves. Use para acompanhar a vinculação tanto pelo Manager quanto por integração externa.', ref('FindHubAuthStatus')),
  'GET /findhub/devices/{instanceName}': operation('Listar dispositivos cadastrados', 'Retorna o catálogo local da instância; não força uma consulta nova ao Google. Telefones usam identifierType ANDROID e deviceType PHONE quando o protocolo informa esse tipo.', { type: 'array', items: ref('FindHubDevice') }),
  'POST /findhub/devices/refresh/{instanceName}': operation('Atualizar catálogo pelo Google Find Hub', 'Consulta Nova usando a conta vinculada e atualiza os dispositivos dessa instância. Exige canal conectado.', { type: 'array', items: ref('FindHubDevice') }),
  'GET /findhub/device/{deviceId}/{instanceName}': operation('Consultar um dispositivo', 'Use o id local retornado na listagem, não googleDeviceId. A consulta permanece restrita à instância autorizada.', ref('FindHubDevice')),
  'POST /findhub/locate/{deviceId}/{instanceName}': operation('Solicitar localização do dispositivo', 'Solicitação ativa via Nova e resposta assíncrona FCM/MCS. Pode retornar null quando não há posição; respeita FINDHUB_LOCATION_TIMEOUT_MS. Timestamp é a data do relatório, não a hora da chamada. Não há promessa de GPS em tempo real ou de localização nova a cada requisição.', { oneOf: [ref('FindHubPosition'), { type: 'null' }] }),
  'POST /findhub/tracking/start/{deviceId}/{instanceName}': operation('Iniciar acompanhamento periódico', 'Persiste a configuração por dispositivo e agenda consultas periódicas. O intervalo aceita zero (consultas serializadas sem espera adicional) e valores inteiros positivos. Frequência e disponibilidade de novas posições dependem do Google e do smartphone.', ref('FindHubTrackingResult'), { requestBody: { ...body('FindHubTrackingRequest', { intervalSeconds: 60 }), required: false } }),
  'POST /findhub/tracking/stop/{deviceId}/{instanceName}': operation('Parar acompanhamento periódico', 'Interrompe o agendamento e persiste trackingEnabled=false; não remove o aparelho da conta Google.', ref('FindHubTrackingResult')),
  'GET /findhub/positions/{deviceId}/{instanceName}': operation('Consultar histórico de posições', 'Retorna somente posições persistidas. FINDHUB_STORE_POSITION_HISTORY=false por padrão; nesse caso novas posições não são inseridas no histórico. Usa recordedAt no registro persistido e ordena da mais recente para a mais antiga.', { type: 'array', items: ref('FindHubStoredPosition') }, { parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } }] }),
  'PUT /findhub/traccar/{deviceId}/{instanceName}': operation('Configurar vínculo com o Traccar', 'Salva vínculo individual via HTTP/OsmAnd. Não cria automaticamente o dispositivo no Traccar. url deve ser alcançável pelo container da API; localhost no container não é o host da VPS.', ref('FindHubTraccarBinding'), { requestBody: body('FindHubTraccarRequest', { enabled: true, url: 'http://traccar:5055', deviceId: 'android-01' }) }),
  'DELETE /findhub/traccar/{deviceId}/{instanceName}': operation('Remover vínculo com o Traccar', 'Remove apenas a integração desse dispositivo na instância. Não remove o smartphone do Google nem o cadastro remoto no Traccar.', {}, { responses: { '204': { description: 'Vínculo removido; resposta sem corpo.' }, ...errors } }),
};

// Browser-assisted producer is optional and is not a public Google OAuth authorization-code flow.
const proofProperties = {
  sessionId: { type: 'string', minLength: 36, maxLength: 36, pattern: '^[0-9a-fA-F-]{36}$' },
  bridgeToken: { type: 'string', minLength: 32, maxLength: 128, writeOnly: true },
};
Object.assign(findHubSchemas, {
  FindHubBrowserStartRequest: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', format: 'email', minLength: 3, maxLength: 320 } } },
  FindHubBrowserProof: { type: 'object', additionalProperties: false, required: ['sessionId', 'bridgeToken'], properties: proofProperties },
  FindHubBrowserExchangeRequest: { type: 'object', additionalProperties: false, required: ['sessionId', 'bridgeToken', 'oauthToken'], properties: { ...proofProperties, oauthToken: { type: 'string', minLength: 1, maxLength: 16384, writeOnly: true, description: 'Artefato temporário do login explicitamente autorizado na extensão; nunca enviar cookies arbitrários ou senha.' } } },
  FindHubBrowserCompleteRequest: { type: 'object', additionalProperties: false, required: ['sessionId', 'bridgeToken', 'vaultKeys'], properties: { ...proofProperties, vaultKeys: { type: 'string', minLength: 1, maxLength: 65536, writeOnly: true, description: 'JSON do callback finder_hw. Outros domínios de segurança não são enviados pela extensão.' } } },
  FindHubBrowserSession: { type: 'object', required: ['sessionId','bridgeToken','state','authMode','expiresAt','loginUrl'], properties: { ...findHubSchemas.FindHubAuthSession.properties, state: { const: 'WAITING_USER' }, authMode: { const: 'browser-extension' }, loginUrl: { type: 'string', format: 'uri' }, browserRequired: { const: true }, helperRequired: { const: true } } },
  FindHubBrowserExchangeResult: { type: 'object', required: ['state','unlockUrl'], properties: { state: { const: 'WAITING_VAULT_KEY' }, unlockUrl: { type: 'string', format: 'uri' } } },
  FindHubBrowserResult: { type: 'object', required: ['state','email','connected'], properties: { state: { const: 'READY' }, email: text, connected: { type: 'boolean' } } },
  FindHubBrowserCancelled: { type: 'object', required: ['state'], properties: { state: { const: 'CANCELLED' } } },
  FindHubDisconnected: { type: 'object', required: ['state','connected'], properties: { state: { const: 'WAITING_AUTH' }, connected: { const: false } } },
});
findHubSchemas.FindHubAuthStatus.properties = {
  ...findHubSchemas.FindHubAuthStatus.properties,
  ready: { type: 'boolean', description: 'True somente com credenciais validadas e transporte MCS autenticado no runtime atual; não garante que o smartphone forneça uma posição nova.' },
  connected: { type: 'boolean' }, connectionState: text, pending: { type: ['object','null'], additionalProperties: true },
  historyEnabled: { type: 'boolean' }, minimumIntervalSeconds: { type: 'integer' }, helper: { type: 'object', additionalProperties: true, description: 'ID público e versão da extensão opcional; indica mobileSupported=false e caminho de download autenticado.' },
};
Object.assign(findHubOperations, {
  'POST /findhub/auth/browser/start/{instanceName}': operation('Iniciar vinculação assistida no navegador', 'Cria tentativa de dez minutos, sem autenticar. O Manager usa a extensão própria no Chrome/Edge desktop; exige aprovação explícita da origem e do servidor em cada tentativa. Não é OAuth público, não é login puramente web/mobile. Desvincule credenciais anteriores antes de iniciar outra conta.', ref('FindHubBrowserSession'), { requestBody: body('FindHubBrowserStartRequest', {email:'operator@example.com'}), responses: response(ref('FindHubBrowserSession'), 'Tentativa criada; usuário ainda precisa autorizar e autenticar.', '201') }),
  'POST /findhub/auth/browser/exchange/{instanceName}': operation('Validar artefato do login Google', 'Troca uma única vez o artefato temporário autorizado pelo usuário; preserva literalmente os bytes do cookie, incluindo %, + e =; o formulário faz encoding uma única vez. O campo Email da resposta é opcional: divergência explícita é rejeitada, e uma segunda solicitação confirma o token de serviço ADM para a conta informada antes de prosseguir. Cada solicitação Google tem timeout de 30 segundos; clientes devem permitir pelo menos 65 segundos para esta etapa. Usa HTTPS/1.1 dedicado sem ALPN, com verificação de certificado e hostname habilitada. Falhas retornam mensagem segura com código FH-AUTH-9101 a FH-AUTH-9116, sem resposta bruta, cookies ou tokens. Exige apikey e prova da sessão. Não persiste senha, não aceita callback genérico e não marca a conta como conectada. A resposta fornece somente o endereço de desbloqueio.', ref('FindHubBrowserExchangeResult'), { requestBody: body('FindHubBrowserExchangeRequest') }),
  'POST /findhub/auth/browser/complete/{instanceName}': operation('Validar chave e concluir conexão Find Hub', 'Recebe o callback finder_hw, verifica a chave contra o envelope da mesma conta, cifra as credenciais e tenta autenticar MCS e listar dispositivos. Só confirma READY após essa verificação. Pode levar até alguns minutos; Google pode recusar o protocolo privado. Não é homologação universal.', ref('FindHubBrowserResult'), { requestBody: body('FindHubBrowserCompleteRequest') }),
  'POST /findhub/auth/browser/cancel/{instanceName}': operation('Cancelar tentativa de vinculação', 'Invalida a tentativa e descarta credenciais temporárias. Uma verificação final já iniciada não pode ser cancelada neste endpoint; aguarde o resultado e use desvincular. Não encerra sessões de outros canais ou contas.', ref('FindHubBrowserCancelled'), { requestBody: body('FindHubBrowserProof') }),
  'GET /findhub/auth/extension/{instanceName}': operation('Obter extensão própria de autenticação', 'Entrega o pacote ZIP versionado e self-hosted da extensão opcional 0.1.6, com ícone oficial e o mesmo ID público. Ao atualizar, substitua os arquivos da pasta já carregada, recarregue a extensão e o Manager. A atualização do backend também é necessária. Requer autenticação da instância. Instale como extensão sem compactação no Chrome/Edge desktop; não exige Chromium/Selenium/VNC no servidor e não instala aplicativo no smartphone rastreado.', {}, { responses: { '200': { description: 'ZIP da extensão própria, sem segredos ou chaves privadas.', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } }, ...errors } }),
  'GET /findhub/traccar/{deviceId}/{instanceName}': operation('Consultar vínculo Traccar do dispositivo', 'Retorna somente o vínculo local do dispositivo pertencente à instância autorizada, ou null quando não configurado. Não consulta o catálogo de dispositivos de outros canais nem fornece uma API de administração remota do Traccar.', { oneOf: [ref('FindHubTraccarBinding'),{type:'null'}] }),
  'POST /findhub/disconnect/{instanceName}': operation('Desvincular conta Google', 'Interrompe o canal, remove credenciais, catálogo local, histórico e vínculos relacionados da instância. Não apaga dispositivos físicos nem a conta Google. Não altera credenciais ou conexões de instâncias WhatsApp. Aguarde eventual verificação final antes de desvincular.', ref('FindHubDisconnected')),
});

// Event transport envelopes differ. These describe the shared data field, not an invented wire envelope.
export const findHubEventMessages = {
  'findhub.auth.update': { description: 'Nome reservado no catálogo atual. O Auth Broker não emite esse evento nos métodos start/import/status; acompanhe a autenticação pelo endpoint de status.', data: { type: 'object', additionalProperties: true } },
  'findhub.devices.updated': { description: 'Catálogo atualizado pela consulta remota.', data: { type: 'object', properties: { devices: { type: 'array', items: { type: 'object', properties: { id: text, name: text, identifierType: text, deviceType: text, trackingEnabled: { type: 'boolean' }, lastLocationAt: { type: ['string', 'null'] } }, additionalProperties: true } } } } },
  'findhub.location.updated': { description: 'Posição obtida; timestamp pertence ao relatório recebido, que pode ser antigo.', data: { type: 'object', properties: { device: { type: 'object', additionalProperties: true }, location: findHubSchemas.FindHubPosition } } },
  'findhub.tracking.update': { description: 'Acompanhamento ativado ou desativado por dispositivo.', data: findHubSchemas.FindHubTrackingResult },
  'findhub.error': { description: 'Erro de acompanhamento, sem credenciais.', data: { type: 'object', properties: { operation: text, deviceId: text, message: text }, additionalProperties: true } },
};

// Native location tracking: independent of messaging providers and optional Traccar.
const trackingProperties = {
  intervalSeconds: {type:'integer',minimum:0,maximum:86400,description:'Espera após cada consulta. 0 não acrescenta espera; nunca há duas consultas simultâneas para o mesmo dispositivo. 60 segundos são recomendados, não impostos. Falhas e limites do provedor usam recuo progressivo.'},
  timeoutMs: {type:'integer',minimum:1,maximum:2147483647,description:'Prazo total da solicitação e espera da localização, em milissegundos, de 1 a 2147483647. Independente do intervalo; reduzir não acelera o Google.'},
  staleAfterSeconds: {type:'integer',minimum:30,maximum:604800,default:300},
  historyEnabled: {type:'boolean',description:'Habilita novas gravações. Não apaga histórico previamente capturado.'},
  retentionDays: {type:'integer',minimum:0,maximum:36500,default:30,description:'0 preserva indefinidamente. Valor positivo permite limpeza por conta em lotes; sem alteração nos históricos de outros canais.'},
};
Object.assign(findHubSchemas, {
  FindHubTrackingSettings: {type:'object',additionalProperties:false,properties:trackingProperties},
  FindHubTraccarConnectionRequest: {type:'object',additionalProperties:false,required:['mode'],properties:{
    mode:{type:'string',enum:['disabled','internal','external']}, url:{type:'string',format:'uri'}, receiverUrl:{type:'string',format:'uri'},
    token:{type:'string',writeOnly:true,maxLength:8192,description:'Somente modo externo. Omissão preserva o segredo anterior apenas para o mesmo servidor.'},
    timeoutMs:{type:'integer',minimum:1000,maximum:60000},
  }},
  FindHubTraccarConnection: {type:'object',properties:{mode:{type:'string',enum:['disabled','internal','external']},url:text,receiverUrl:text,hasToken:{type:'boolean'},timeoutMs:{type:'integer'},state:text,available:{type:'boolean'},internalAvailable:{type:'boolean'}}},
  FindHubTrackingSnapshot:{type:'object',required:['instanceId','connected','settings','devices','counts'],properties:{
    instanceId:text,name:text,email:text,connected:{type:'boolean'},settings:ref('FindHubTrackingSettings'),minimumIntervalSeconds:{type:'integer'},
    devices:{type:'array',items:ref('FindHubDevice')}, counts:{type:'object',properties:{devices:{type:'integer'},tracking:{type:'integer'},positions:{type:'integer'}}},
    map:{type:'object',properties:{tileUrl:text}},catalogue:{type:'object',properties:{limitation:text}},traccar:ref('FindHubTraccarConnection'),
  }},
});
Object.assign(findHubSchemas.FindHubDevice.properties, {
  latestPosition:{oneOf:[ref('FindHubPosition'),{type:'null'}]}, lastReceivedAt:{type:['string','null'],format:'date-time'}, lastAttemptAt:{type:['string','null'],format:'date-time'},
  lastErrorCode:{type:['string','null']}, locationTimeoutMs:{type:['integer','null']}, availability:{type:'string',enum:['offline','online','recent','stale','no_location']},
});
findHubSchemas.FindHubPosition.properties.source.enum.push('TRACCAR');
findHubSchemas.FindHubTrackingRequest.properties={intervalSeconds:trackingProperties.intervalSeconds,timeoutMs:trackingProperties.timeoutMs};
findHubSchemas.FindHubTrackingResult.properties.timeoutMs=trackingProperties.timeoutMs;
findHubSchemas.FindHubTraccarBinding.properties.traccarNumericId={type:['integer','null']};
Object.assign(findHubOperations, {
 'GET /findhub/tracking/snapshot/{instanceName}':operation('Consultar estado do mapa e da conta','Snapshot autorizado, posições mais recentes, estado do acompanhamento, configurações e contadores reais. Nunca contém credenciais Google/Traccar. Posição recente não é prova de aparelho online.',ref('FindHubTrackingSnapshot')),
 'GET /findhub/tracking/stream/{instanceName}':operation('Acompanhar posições por SSE','Usa o mesmo apikey e guards de instância. Cliente fetch com header, nunca token em query. Evento inicial snapshot seguido de updates do barramento Find Hub. Reautoriza a cada reconexão (até 120 segundos); heartbeat a cada 15 segundos. Máximo de 20 assinaturas por conta, fila inicial 100 eventos e buffer de saída limitado. Não efetua polling Google adicional por assinante.',{}, {responses:{'200':{description:'Stream text/event-stream: event: update; data contém {event,instanceId,at,data}. Snapshot inicial contém {event:"snapshot",data:FindHubTrackingSnapshot}.',content:{'text/event-stream':{schema:{type:'string'}}}},...errors}}),
 'GET /findhub/tracking/settings/{instanceName}':operation('Consultar parâmetros do rastreamento','Configuração efetiva desta conta. O ambiente fornece somente os valores iniciais.',ref('FindHubTrackingSettings')),
 'PUT /findhub/tracking/settings/{instanceName}':operation('Salvar parâmetros e retenção da conta','Mescla somente campos permitidos. Histórico habilitado é independente do Traccar. Reduzir retenção autoriza descarte das posições locais anteriores ao prazo; 0 preserva. Os intervalos já salvos por dispositivo são alterados na ação de acompanhamento daquele dispositivo.',ref('FindHubTrackingSettings'),{requestBody:body('FindHubTrackingSettings',{intervalSeconds:60,timeoutMs:30000,staleAfterSeconds:300,historyEnabled:true,retentionDays:30})}),
 'GET /findhub/traccar/configuration/{instanceName}':operation('Consultar integração oficial Traccar','Retorna modo, disponibilidade e hasToken. Segredo e endereço interno não são enviados ao frontend.',ref('FindHubTraccarConnection')),
 'PUT /findhub/traccar/configuration/{instanceName}':operation('Configurar Traccar interno ou externo','No modo interno a API resolve URL e credenciais da instalação. Externo exige origens HTTPS previamente autorizadas pelo administrador e token protegido. Valida sessão oficial antes de salvar; alteração de destino invalida somente vínculos locais de forma transacional, preservando dispositivos e históricos remotos. Desabilitar não afeta o canal Google.',ref('FindHubTraccarConnection'),{requestBody:body('FindHubTraccarConnectionRequest',{mode:'internal',timeoutMs:10000})}),
 'POST /findhub/traccar/provision/{deviceId}/{instanceName}':operation('Provisionar dispositivo no Traccar e vincular','Consulta/cria dispositivo pela API oficial usando identificador estável derivado de conta + dispositivo e valida a associação. Retorna vínculo local. Posições usam OsmAnd; eventos retornam por /api/socket com sessão exclusiva do backend e são filtrados por vínculo/conta.',ref('FindHubTraccarBinding')),
});
findHubOperations['GET /findhub/positions/{deviceId}/{instanceName}'].description='Histórico local desta conta/dispositivo, mais recente primeiro. Gravação controlada nas configurações da conta; posições anteriores continuam legíveis ao desabilitar novas gravações. Sem recuperar histórico que nunca foi coletado. Retenção 0 é indefinida; valores positivos permitem limpeza em lotes.';
findHubOperations['GET /findhub/positions/{deviceId}/{instanceName}'].parameters.push(...['from','to'].map(name=>({name,in:'query',required:false,schema:timestamp})));
findHubOperations['POST /findhub/locate/{deviceId}/{instanceName}'].description='Solicita posição pelo protocolo Google. Timeout efetivo por dispositivo (1 a 2147483647 ms), independente do intervalo. A última posição é preservada mesmo com histórico desabilitado; não é substituída por relatório mais antigo. Integração Traccar opcional não impede a gravação nem a entrega do evento local quando indisponível.';
findHubOperations['POST /findhub/devices/refresh/{instanceName}'].description='Consulta os catálogos SPOT e Android disponíveis à conta e une identificadores canônicos, sem descartar acessórios quando coexistirem com identificadores de telefone. O catálogo principal é preservado se a consulta complementar for recusada. Compartilhamento Family Link não equivale a permissão neste protocolo privado; dispositivos não retornados pelo Google não são fabricados.';
findHubOperations['PUT /findhub/traccar/{deviceId}/{instanceName}'].description='Modo legado: vínculo manual com receptor OsmAnd explicitamente autorizado em TRACCAR_ALLOWED_ORIGINS. Não provisiona cadastro remoto nem altera a configuração global; use provision para a integração oficial automática. Destino interno só é aceito quando habilitado.';
findHubEventMessages['findhub.tracking.update']={description:'Alteração do acompanhamento por dispositivo, configuração da conta ou estado do Traccar. Envelope segue o transporte existente; SSE acrescenta instanceId e at.',data:{type:'object',properties:{deviceId:text,enabled:{type:'boolean'},intervalSeconds:{type:'integer'},timeoutMs:{type:'integer'},providerStatus:text,traccarState:text,settings:findHubSchemas.FindHubTrackingSettings}}};

findHubSchemas.FindHubLocateRequest={type:'object',additionalProperties:false,properties:{timeoutMs:trackingProperties.timeoutMs}};
findHubOperations['POST /findhub/locate/{deviceId}/{instanceName}'].requestBody={required:false,content:{'application/json':{schema:ref('FindHubLocateRequest'),example:{timeoutMs:45000}}}};
findHubOperations['POST /findhub/locate/{deviceId}/{instanceName}'].description+=' Corpo opcional timeoutMs sobrepõe o prazo somente nesta consulta, sem ativar acompanhamento ou alterar parâmetros persistidos.';

findHubSchemas.FindHubDevice.properties.avatarData = {type:['string','null'],description:'PNG normalizado. O snapshot/SSE contém apenas avatarVersion; use GET device/avatar para buscar a imagem.'};
findHubSchemas.FindHubDevice.properties.avatarVersion = {type:['string','null'],description:'Revisão opaca do avatar, sem expor a imagem em atualizações de posição.'};
findHubSchemas.FindHubDeviceAvatarRequest = {type:'object',additionalProperties:false,required:['avatar'],properties:{avatar:{type:['string','null'],maxLength:174786,description:'Data URL PNG RGB/RGBA de até 256x256 e 128 KiB. null remove o avatar. Sem URLs externas ou SVG.'}}};
findHubOperations['PUT /findhub/device/avatar/{deviceId}/{instanceName}'] = operation('Definir ou remover avatar do dispositivo','Valida propriedade da instância e PNG; remove metadados. Não modifica o dispositivo Google nem é sobrescrito na sincronização.',ref('FindHubDevice'),{requestBody:body('FindHubDeviceAvatarRequest',{avatar:null})});
findHubOperations['GET /findhub/device/avatar/{deviceId}/{instanceName}'] = operation('Obter avatar privado do dispositivo','Mesma autenticação por instância; não inclua tokens em URLs. Resposta sem cache compartilhado.',{type:'object',properties:{avatarData:{type:['string','null']}}});

// Additive diagnostics: no authentication material and no breaking change to locate response.
findHubSchemas.FindHubLocationQuery = {type:'object',required:['status','startedAt','completedAt','timeoutMs'],properties:{status:{type:'string',enum:['new_report','known_position','no_position','timeout','failed']},startedAt:timestamp,completedAt:timestamp,timeoutMs:trackingProperties.timeoutMs}};
findHubSchemas.FindHubDevice.properties.lastQuery={oneOf:[ref('FindHubLocationQuery'),{type:'null'}],description:'Resultado da última consulta nesta execução do servidor. Não transforma uma posição antiga em atual.'};
for (const event of ['findhub.location.updated','findhub.tracking.update','findhub.error']) {
  if (findHubEventMessages[event]?.data?.properties) findHubEventMessages[event].data.properties.query=findHubSchemas.FindHubLocationQuery;
}
findHubOperations['POST /findhub/locate/{deviceId}/{instanceName}'].description+=' Cada solicitação envia um comando real e correlaciona a resposta FCM pelo UUID. Relatório repetido não encerra a espera antes de uma observação mais nova ou do deadline absoluto. No deadline, somente relatórios realmente recebidos nessa consulta podem ser retornados como última posição conhecida. Sem resposta, ocorre timeout; nunca existe fallback silencioso ao banco. O resultado detalhado está em lastQuery no snapshot e query nos eventos; new_report significa mais recente que o relatório local, não GPS necessariamente atual.';

// Gap reconciliation is additive to the existing local history. The provider can return
// older RECENT/NETWORK reports, but completeness for an arbitrary interval is never promised.
findHubSchemas.FindHubReconciliationRequest = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: timestamp,
    to: timestamp,
    attempts: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
    timeoutMs: trackingProperties.timeoutMs,
  },
};
findHubSchemas.FindHubReconciliationResult = {
  type: 'object',
  required: [
    'deviceId',
    'status',
    'from',
    'to',
    'startedAt',
    'completedAt',
    'attemptsRequested',
    'attemptsCompleted',
    'positionsBefore',
    'positionsAfter',
    'recoveredPositions',
    'providerReportsObserved',
    'completenessGuaranteed',
  ],
  properties: {
    deviceId: text,
    deviceName: text,
    status: { type: 'string', enum: ['recovered', 'no_recoverable_positions'] },
    from: timestamp,
    to: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    attemptsRequested: { type: 'integer', minimum: 1, maximum: 10 },
    attemptsCompleted: { type: 'integer', minimum: 0, maximum: 10 },
    positionsBefore: { type: 'integer', minimum: 0 },
    positionsAfter: { type: 'integer', minimum: 0 },
    recoveredPositions: { type: 'integer', minimum: 0 },
    providerReportsObserved: { type: 'integer', minimum: 0 },
    firstRecoveredAt: { type: ['string', 'null'], format: 'date-time' },
    lastRecoveredAt: { type: ['string', 'null'], format: 'date-time' },
    sources: { type: 'array', items: { type: 'string' } },
    completenessGuaranteed: { const: false },
    note: text,
  },
};
findHubSchemas.FindHubReconciliationBatchResult = {
  type: 'object',
  required: ['startedAt', 'completedAt', 'automatic', 'settings', 'results'],
  properties: {
    startedAt: timestamp,
    completedAt: timestamp,
    automatic: { const: false },
    settings: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        minGapSeconds: { type: 'integer', minimum: 30, maximum: 2592000 },
        attempts: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
    results: {
      type: 'array',
      items: {
        oneOf: [
          ref('FindHubReconciliationResult'),
          {
            type: 'object',
            required: ['deviceId', 'status', 'error'],
            properties: { deviceId: text, deviceName: text, status: { const: 'failed' }, error: text },
          },
        ],
      },
    },
  },
};

findHubOperations['POST /findhub/positions/reconcile/{deviceId}/{instanceName}'] = operation(
  'Reconciliar lacuna de um dispositivo',
  'Executa recuperação best effort no Google Find Hub para um dispositivo. Importa e deduplica todos os relatórios válidos RECENT/NETWORK realmente devolvidos pelo provider, inclusive relatórios fora do intervalo usado como métrica. Não interpola posições e não promete reconstrução completa da lacuna.',
  ref('FindHubReconciliationResult'),
  {
    requestBody: {
      required: false,
      content: { 'application/json': { schema: ref('FindHubReconciliationRequest') } },
    },
  },
);
findHubOperations['POST /findhub/positions/reconcile/{instanceName}'] = operation(
  'Reconciliar dispositivos rastreados da instância',
  'Executa manualmente a reconciliação dos dispositivos com tracking habilitado nesta instância. Cada dispositivo reutiliza a persistência idempotente do histórico e devolve o resultado individual sem fabricar posições ausentes no Google.',
  ref('FindHubReconciliationBatchResult'),
  {
    requestBody: {
      required: false,
      content: { 'application/json': { schema: ref('FindHubReconciliationRequest') } },
    },
  },
);

