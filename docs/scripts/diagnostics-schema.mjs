const ref = name => ({ $ref: `#/components/schemas/${name}` });
const nonnegativeInteger = { type: 'integer', minimum: 0 };
const identifier = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]{1,128}$' };
const utcTimestamp = {
  type: 'string', format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
  description: 'Instante ISO 8601 em UTC, com sufixo Z.',
};
const levels = ['info', 'warn', 'error'];
const categories = ['http', 'error', 'connection', 'call', 'runtime', 'frontend', 'system'];
const codes = ['http.request', 'webhook.delivery', 'runtime.started', 'runtime.sample', 'runtime.error',
  'connection.state', 'call.signaling', 'call.state', 'call.action', 'call.media', 'frontend.error',
  'diagnostics.exported', 'diagnostics.settings'];
const filterProperties = {
  from: { ...utcTimestamp, description: 'Início inclusivo. Quando from e to são informados, o intervalo máximo é 30 dias.' },
  to: { ...utcTimestamp, description: 'Fim inclusivo, igual ou posterior a from.' },
  level: { type: 'string', enum: levels },
  category: { type: 'string', enum: categories },
  code: { type: 'string', enum: codes },
  traceId: { ...identifier, description: 'Identificador técnico exato da requisição ou entrega.' },
  callId: { ...identifier, description: 'Identificador técnico exato da chamada; não é telefone ou contato.' },
  instanceId: { ...identifier, description: 'Pseudônimo da instância retornado nos eventos, por exemplo instance-012345abcdef.' },
};
const filters = Object.entries(filterProperties).map(([name, schema]) => ({ name, in: 'query', required: false, schema }));
const headers = {
  'Cache-Control': { schema: { type: 'string', const: 'no-store' }, description: 'Respostas administrativas não devem ser armazenadas em cache.' },
  'X-Content-Type-Options': { schema: { type: 'string', const: 'nosniff' } },
};
const json = (description, schema) => ({ description, headers, content: { 'application/json': { schema } } });
const errors = {
  '400': json('Filtro, corpo ou parâmetro desconhecido/inválido.', ref('DiagnosticApiError')),
  '403': json('Exige a chave global de administração no header apikey. Chaves de instância não são aceitas.', ref('DiagnosticApiError')),
  '429': { ...json('Limite de concorrência ou de coleta atingido; aguarde antes de repetir.', ref('DiagnosticApiError')),
    headers: { ...headers, 'Retry-After': { schema: { type: 'integer', minimum: 1 }, description: 'Espera sugerida em segundos.' } } },
  '503': json('Diagnóstico temporariamente indisponível. A resposta não inclui a exceção original.', ref('DiagnosticApiError')),
};
const adminDescription = 'Exige exclusivamente a API key global no header apikey; token de instância não autoriza este recurso. Coleta nativa já ativa, sem variável de ambiente adicional. ';
const common = { tags: ['Diagnostics'], security: [{ apiKey: [] }] };

export const diagnosticSchemas = {
  DiagnosticApiError: {
    type: 'object', additionalProperties: false, required: ['error'],
    properties: { error: { type: 'string', description: 'Mensagem fixa, sem conteúdo de requisição ou detalhes privados.' } },
  },
  DiagnosticEvent: {
    type: 'object', additionalProperties: false,
    required: ['id', 'timestamp', 'level', 'category', 'code', 'summary', 'details'],
    properties: {
      id: { type: 'string', format: 'uuid' }, timestamp: utcTimestamp,
      level: { type: 'string', enum: levels }, category: { type: 'string', enum: categories },
      code: { type: 'string', enum: codes },
      summary: { type: 'string', description: 'Descrição fixa do catálogo técnico, nunca texto de conversa ou da exceção.' },
      traceId: identifier, callId: identifier,
      instanceId: { type: 'string', pattern: '^instance-[a-f0-9]{12}$', description: 'Pseudônimo estável da instância.' },
      component: { type: 'string', description: 'Componente técnico conhecido ou pseudônimo de componente.' },
      details: { type: 'object', additionalProperties: true,
        description: 'Campos técnicos permitidos por code: status, duração, tentativa, estado, tipo de sinalização, métricas ou erro sanitizado. Estrutura limitada e validada pelo servidor. Nunca inclui conversas, áudio, mídia, tokens, cabeçalhos, corpos HTTP, frames binários ou mensagens brutas de exceção.' },
    },
  },
  DiagnosticStatus: {
    type: 'object', additionalProperties: false,
    required: ['ready', 'persistent', 'storageError', 'diskBytes', 'maxDiskBytes', 'retentionDays', 'storedEvents',
      'dropped', 'counts', 'categories', 'schemaVersion', 'service', 'version', 'startedAt', 'privacy'],
    properties: {
      ready: { type: 'boolean', description: 'Inicialização do coletor concluída.' },
      persistent: { type: 'boolean', description: 'Armazenamento em disco inicializado; avalie também storageError.' },
      storageError: { type: 'boolean', description: 'Foi observada falha de armazenamento/leitura. O histórico pode estar incompleto.' },
      diskBytes: nonnegativeInteger, maxDiskBytes: nonnegativeInteger,
      retentionDays: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
      storedEvents: nonnegativeInteger,
      dropped: { ...nonnegativeInteger, description: 'Registros descartados por limites/falhas durante o processo atual.' },
      counts: { type: 'object', additionalProperties: false, required: levels,
        properties: Object.fromEntries(levels.map(level => [level, nonnegativeInteger])) },
      categories: { type: 'object', additionalProperties: nonnegativeInteger, propertyNames: { enum: categories } },
      schemaVersion: { type: 'integer', const: 1 }, service: { type: 'string', const: 'ARGWS Connect API' },
      version: { type: 'string' }, startedAt: utcTimestamp,
      privacy: { type: 'string', const: 'technical_metadata_only' },
    },
  },
  DiagnosticPage: {
    type: 'object', additionalProperties: false, required: ['events', 'nextCursor'],
    properties: {
      events: { type: 'array', maxItems: 200, items: ref('DiagnosticEvent'), description: 'Ordem decrescente por timestamp e id.' },
      nextCursor: { type: ['string', 'null'], maxLength: 300, description: 'Cursor opaco da próxima página; null indica o fim. Preserve os mesmos filtros.' },
    },
  },
  DiagnosticFilters: { type: 'object', additionalProperties: false, properties: filterProperties },
  DiagnosticExportManifest: {
    type: 'object', additionalProperties: false,
    required: ['type', 'schemaVersion', 'exportedAt', 'filters', 'diagnostics'],
    properties: {
      type: { type: 'string', const: 'manifest' }, schemaVersion: { type: 'integer', const: 1 },
      exportedAt: utcTimestamp, filters: ref('DiagnosticFilters'), diagnostics: ref('DiagnosticStatus'),
    },
  },
  DiagnosticSettingsRequest: {
    type: 'object', additionalProperties: false, required: ['retentionDays', 'maxDiskMB'],
    properties: {
      retentionDays: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
      maxDiskMB: { type: 'integer', minimum: 32, maximum: 512, default: 128,
        description: 'Limite em MiB (1.048.576 bytes). Registros antigos são removidos conforme retenção e quota.' },
    },
  },
  DiagnosticClientEventRequest: {
    type: 'object', additionalProperties: false, required: ['kind', 'page'],
    properties: {
      kind: { type: 'string', enum: ['window_error', 'unhandled_rejection', 'vue_error'] },
      page: { type: 'string', enum: ['calls', 'diagnostics', 'instances', 'login', 'settings', 'unknown'],
        description: 'Área fixa do Manager; nunca URL, nome de contato ou parâmetro da página.' },
      traceId: identifier,
    },
  },
};

export const diagnosticOperations = {
  'GET /diagnostics/status': {
    ...common, summary: 'Consultar estado do diagnóstico nativo',
    description: adminDescription + 'Retorna disponibilidade, retenção, ocupação, contagens e sinalização de perdas. Não aceita parâmetros de consulta. As contagens abrangem os registros retidos, não um filtro da tela.',
    responses: { '200': json('Estado do coletor e do armazenamento.', ref('DiagnosticStatus')), ...errors },
  },
  'GET /diagnostics/events': {
    ...common, summary: 'Consultar eventos técnicos com rastreabilidade',
    description: adminDescription + 'Filtros combinados por igualdade e período inclusivo em UTC. Retorna os registros mais recentes primeiro. Sem filtros de data, consulta a retenção disponível. Máximo de quatro leituras simultâneas, incluindo exportações.',
    parameters: [...filters,
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
      { name: 'cursor', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 300, pattern: '^[A-Za-z0-9_-]+$' },
        description: 'Copie nextCursor da resposta anterior, mantendo os filtros. Não construa o cursor manualmente.' }],
    responses: { '200': json('Página de eventos sanitizados.', ref('DiagnosticPage')), ...errors },
  },
  'GET /diagnostics/export': {
    ...common, summary: 'Baixar histórico técnico filtrado em JSONL ou GZIP',
    description: adminDescription + 'Exporta todos os registros retidos que correspondem aos filtros, sem paginação; cursor e limit são rejeitados. A primeira linha JSONL é DiagnosticExportManifest; cada linha seguinte é DiagnosticEvent. Com format=gzip, o mesmo fluxo é compactado. Máximo de duas exportações e quatro leituras simultâneas. Falha após o início da transmissão interrompe o download; não considere um arquivo interrompido como completo. Consulte storageError e dropped no manifesto para identificar perdas de coleta.',
    parameters: [...filters, { name: 'format', in: 'query', schema: { type: 'string', enum: ['jsonl', 'gzip'], default: 'gzip' } }],
    responses: {
      '200': {
        description: 'Download em streaming. Nome connect-diagnostics-YYYYMMDD.jsonl ou .jsonl.gz.',
        headers: { ...headers, 'Content-Disposition': { schema: { type: 'string' }, description: 'attachment com nome fixo gerado pelo servidor.' } },
        content: {
          'application/x-ndjson': { schema: { type: 'string', description: 'JSON por linha: manifesto seguido de eventos técnicos.' },
            'x-ndjson-item-schema': { oneOf: [ref('DiagnosticExportManifest'), ref('DiagnosticEvent')] } },
          'application/gzip': { schema: { type: 'string', format: 'binary', description: 'Fluxo JSONL compactado com GZIP.' } },
        },
      }, ...errors,
    },
  },
  'PUT /diagnostics/settings': {
    ...common, summary: 'Atualizar retenção e quota do diagnóstico',
    description: adminDescription + 'Persiste os limites no volume existente, sem reiniciar a API ou configurar env. Ambos os campos são obrigatórios. A redução dos limites pode remover registros técnicos antigos. Não aceita parâmetros de consulta.',
    requestBody: { required: true, content: { 'application/json': { schema: ref('DiagnosticSettingsRequest') } } },
    responses: { '200': json('Estado do diagnóstico após persistir a configuração.', ref('DiagnosticStatus')), ...errors },
  },
  'POST /diagnostics/client-events': {
    ...common, summary: 'Registrar erro técnico do Manager sem conteúdo',
    description: adminDescription + 'Aceita somente categoria fixa do erro, área da tela e traceId opcional. Mensagem, stack, URL, corpo ou qualquer outra propriedade são rejeitados. Limite de 60 eventos por minuto por processo da API. Não aceita parâmetros de consulta.',
    requestBody: { required: true, content: { 'application/json': { schema: ref('DiagnosticClientEventRequest') } } },
    responses: { '202': json('Evento aceito pelo coletor técnico.', { type: 'object', additionalProperties: false,
      required: ['accepted'], properties: { accepted: { type: 'boolean', const: true } } }), ...errors },
  },
};
