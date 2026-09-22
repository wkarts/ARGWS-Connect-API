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
    properties: { intervalSeconds: { type: 'integer', minimum: 15, maximum: 3600, description: 'A API respeita também FINDHUB_MIN_TRACKING_INTERVAL_SECONDS; trata-se de consulta periódica, não GPS contínuo.' } },
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
  'POST /findhub/tracking/start/{deviceId}/{instanceName}': operation('Iniciar acompanhamento periódico', 'Persiste a configuração por dispositivo e agenda consultas periódicas. O intervalo efetivo respeita o mínimo do ambiente. Frequência e disponibilidade de novas posições dependem do Google e do smartphone.', ref('FindHubTrackingResult'), { requestBody: { ...body('FindHubTrackingRequest', { intervalSeconds: 60 }), required: false } }),
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
  'GET /findhub/auth/extension/{instanceName}': operation('Obter extensão própria de autenticação', 'Entrega o pacote ZIP versionado e self-hosted da extensão opcional 0.1.4, com ícone oficial e o mesmo ID público. Ao atualizar, substitua os arquivos da pasta já carregada, recarregue a extensão e o Manager. A atualização do backend também é necessária. Requer autenticação da instância. Instale como extensão sem compactação no Chrome/Edge desktop; não exige Chromium/Selenium/VNC no servidor e não instala aplicativo no smartphone rastreado.', {}, { responses: { '200': { description: 'ZIP da extensão própria, sem segredos ou chaves privadas.', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } }, ...errors } }),
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
