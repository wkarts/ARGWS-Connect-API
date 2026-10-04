import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { localTemplateSchemas, localTemplateOperations, localTemplatePagination } from './local-template-schemas.mjs';
import { operationsStatisticsOperation } from './operations-statistics-schema.mjs';
import { diagnosticOperations, diagnosticSchemas } from './diagnostics-schema.mjs';
import { metaCompatibleSchemas, metaCompatibilityAdminSchemas } from './meta-compatible-schemas.mjs';
import { videoCallOperations, videoCallSchemas } from './video-call-schemas.mjs';
import { findHubOperations, findHubSchemas, findHubEventMessages } from './findhub-schemas.mjs';

const ROOT = process.cwd();
const API_DIRS = [
  path.join(ROOT, 'src', 'api', 'routes'),
  path.join(ROOT, 'src', 'api', 'integrations'),
  path.join(ROOT, 'src', 'api', 'compat', 'meta-cloud'),
];
const OUTPUT_DIR = path.join(ROOT, 'docs', 'openapi');
const ASYNC_DIR = path.join(ROOT, 'docs', 'asyncapi');
const CHECK_MODE = process.argv.includes('--check');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.router.ts')) result.push(absolute);
  }
  return result;
}

function normalizePath(value) {
  let result = value || '/';
  result = result.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!result.startsWith('/')) result = '/' + result;
  result = result.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  if (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

function joinPaths(...parts) {
  const joined = parts.filter(Boolean).join('/').replace(/\/+/g, '/');
  return normalizePath(joined);
}

function humanize(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function operationId(method, apiPath) {
  return `${method}_${apiPath}`
    .replace(/[{}]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function tagFromPath(apiPath, sourceFile) {
  const segment = apiPath.split('/').filter(Boolean)[0];
  const map = {
    instance: 'Instances', message: 'Messages', chat: 'Chats & Contacts', group: 'Groups', business: 'Business',
    call: 'Calls', localTemplate: 'Local Templates', template: 'Templates', settings: 'Settings', proxy: 'Proxy', label: 'Labels', webhook: 'Webhooks',
    websocket: 'WebSocket', rabbitmq: 'RabbitMQ', nats: 'NATS', pusher: 'Pusher', sqs: 'SQS', kafka: 'Kafka',
    s3: 'Storage', storage: 'Storage', minio: 'Storage', chatbot: 'Chatbots', typebot: 'Chatbots', openai: 'Chatbots',
    dify: 'Chatbots', flowise: 'Chatbots', n8n: 'Chatbots', evoai: 'Chatbots', connectai: 'Chatbots',
    compat: 'Meta Compatible Admin', diagnostics: 'Diagnostics', 'manager-api': 'Manager',
  };
  if (map[segment]) return map[segment];
  if (sourceFile.includes('/integrations/event/')) return 'Events';
  if (sourceFile.includes('/integrations/storage/')) return 'Storage';
  if (sourceFile.includes('/integrations/chatbot/')) return 'Chatbots';
  if (sourceFile.includes('/integrations/channel/')) return 'Channels';
  return 'Core';
}

function pathParameters(apiPath) {
  const params = [];
  for (const match of apiPath.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1];
    params.push({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string', minLength: 1 },
      description: name === 'instanceName' ? 'Nome exato da instância Connect|API. Preenchimento obrigatório antes de executar a requisição.' : `Parâmetro de rota ${name}.`,
    });
  }
  return params;
}

function sourceRelative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function parseRouterFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const classMatch = source.match(/export\s+class\s+([A-Za-z0-9_]+)/);
  const className = classMatch?.[1] || null;
  const mounts = [];
  const endpoints = [];

  const mountRegex = /\.use\(\s*['"]([^'"]*)['"]\s*,\s*new\s+([A-Za-z0-9_]+)\s*\(/gms;
  for (const match of source.matchAll(mountRegex)) mounts.push({ prefix: match[1], child: match[2] });

  const routerPathRegex = /\.(get|post|put|patch|delete)\(\s*this\.routerPath\(\s*['"]([^'"]+)['"]\s*(?:,\s*(false|true))?\s*\)/gims;
  for (const match of source.matchAll(routerPathRegex)) {
    const method = match[1].toLowerCase();
    const operation = match[2];
    const withInstance = match[3] !== 'false';
    endpoints.push({
      method,
      localPath: `/${operation}${withInstance ? '/{instanceName}' : ''}`,
      operation,
      sourceFile: sourceRelative(file),
    });
  }

  const literalRegex = /\.(get|post|put|patch|delete)\(\s*['"](\/[^'"]*)['"]/gims;
  for (const match of source.matchAll(literalRegex)) {
    const method = match[1].toLowerCase();
    const localPath = match[2];
    if (localPath === '/manager' || localPath.startsWith('/assets')) continue;
    endpoints.push({
      method,
      localPath,
      operation: localPath.split('/').filter(Boolean).pop() || 'root',
      sourceFile: sourceRelative(file),
    });
  }

  return { file, className, mounts, endpoints };
}

function discoverRoutes() {
  const files = API_DIRS.flatMap(walk);
  const parsed = files.map(parseRouterFile);
  const byClass = new Map(parsed.filter((item) => item.className).map((item) => [item.className, item]));
  const prefixes = new Map();

  const indexFile = path.join(ROOT, 'src', 'api', 'routes', 'index.router.ts');
  if (fs.existsSync(indexFile)) {
    const index = parseRouterFile(indexFile);
    for (const mount of index.mounts) {
      if (!prefixes.has(mount.child)) prefixes.set(mount.child, new Set());
      prefixes.get(mount.child).add(normalizePath(mount.prefix || '/'));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [className, prefixSet] of prefixes.entries()) {
      const parsedClass = byClass.get(className);
      if (!parsedClass) continue;
      for (const parentPrefix of [...prefixSet]) {
        for (const mount of parsedClass.mounts) {
          const childPrefix = joinPaths(parentPrefix, mount.prefix || '/');
          if (!prefixes.has(mount.child)) prefixes.set(mount.child, new Set());
          const childSet = prefixes.get(mount.child);
          if (!childSet.has(childPrefix)) {
            childSet.add(childPrefix);
            changed = true;
          }
        }
      }
    }
  }

  const discovered = [];
  for (const item of parsed) {
    if (item.file === indexFile) {
      for (const endpoint of item.endpoints) {
        discovered.push({ ...endpoint, apiPath: normalizePath(endpoint.localPath), className: 'RootRouter' });
      }
      continue;
    }
    const classPrefixes = item.className && prefixes.get(item.className);
    const effectivePrefixes = classPrefixes?.size ? [...classPrefixes] : ['/'];
    for (const prefix of effectivePrefixes) {
      for (const endpoint of item.endpoints) {
        discovered.push({ ...endpoint, apiPath: joinPaths(prefix, endpoint.localPath), className: item.className || path.basename(item.file) });
      }
    }
  }

  const unique = new Map();
  for (const route of discovered) {
    const key = `${route.method.toUpperCase()} ${route.apiPath}`;
    if (!unique.has(key)) unique.set(key, route);
  }
  return [...unique.values()].sort((a, b) => a.apiPath === b.apiPath ? a.method.localeCompare(b.method) : a.apiPath.localeCompare(b.apiPath));
}

const requestOverrides = {
  'GET /v1/transcriptions': {
    summary: 'Listar transcrições',
    description: 'Lista os jobs recentes de transcrição desta instalação. O conteúdo é processado pelo worker local e permanece protegido pela API key.',
    responses: {
      '200': { description: 'Jobs recentes.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TranscriptionJob' } } } } },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '503': { description: 'Banco de dados ou transcrição indisponível.' },
    },
  },
  'GET /v1/transcriptions/health': {
    summary: 'Verificar worker de transcrição',
    description: 'Consulta somente o estado da fila RabbitMQ e do consumidor local. Não publica, repete nem remove jobs.',
    responses: {
      '200': {
        description: 'Diagnóstico da fila, do worker local e do limite de upload ativo.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                queue: { type: 'string' },
                connected: { type: 'boolean' },
                consumerCount: { type: 'integer', minimum: 0 },
                workerReady: { type: 'boolean' },
                messageCount: { type: 'integer', minimum: 0 },
                staleJobSeconds: { type: 'integer', minimum: 60 },
                maxUploadBytes: { type: 'integer', minimum: 1, maximum: 262144000 },
                queuedJobs: { type: 'integer', minimum: 0 },
                processingJobs: { type: 'integer', minimum: 0 },
                oldestQueuedSeconds: { type: 'integer', nullable: true, minimum: 0 },
              },
              required: ['enabled', 'queue', 'connected', 'consumerCount', 'workerReady', 'staleJobSeconds', 'maxUploadBytes'],
            },
          },
        },
      },
      '401': { $ref: '#/components/responses/Unauthorized' },
    },
  },
  'POST /v1/transcriptions/upload': {
    summary: 'Enviar áudio para transcrição',
    description: 'Recebe um arquivo de áudio em multipart/form-data, armazena-o no MinIO privado e cria um job para o worker local. Nenhum provedor externo é chamado.',
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['audio'],
            properties: {
              audio: { type: 'string', format: 'binary' },
              language: { type: 'string', example: 'pt' },
              model: { type: 'string', example: 'Xenova/whisper-small' },
            },
          },
        },
      },
    },
    responses: {
      '202': { description: 'Áudio aceito e job criado.', content: { 'application/json': { schema: { $ref: '#/components/schemas/TranscriptionJob' } } } },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '413': { description: 'O áudio excede o limite configurado.' },
      '415': { description: 'Formato de áudio não suportado.' },
      '503': { description: 'MinIO, fila ou worker indisponível.' },
    },
  },
  'POST /v1/transcriptions/cleanup': {
    summary: 'Limpar áudios temporários expirados',
    description: 'Remove somente objetos de áudio e registros/resultado de jobs enviados diretamente para a API que já passaram da retenção. Mídias e jobs de mensagens existentes não são removidos. Exige confirm=true no corpo para evitar exclusão acidental.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['confirm'],
            properties: {
              confirm: { type: 'boolean', enum: [true] },
              olderThanSeconds: { type: 'integer', minimum: 1, maximum: 31536000, example: 86400 },
              limit: { type: 'integer', minimum: 1, maximum: 1000, example: 250 },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'Resumo da limpeza executada.' },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '503': { description: 'MinIO ou banco indisponível.' },
    },
  },
  'POST /v1/transcriptions': {
    summary: 'Enfileirar transcrição de áudio',
    description: 'Cria um job assíncrono para uma mídia de áudio já persistida pelo Connect|API. Exige a API key global e o messageId da mensagem.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['messageId'],
            properties: {
              messageId: { type: 'string', minLength: 1 },
              language: { type: 'string', example: 'pt' },
              model: { type: 'string', example: 'Xenova/whisper-small' },
            },
          },
        },
      },
    },
    responses: {
      '202': { description: 'Job aceito e persistido.' },
      '400': { $ref: '#/components/responses/BadRequest' },
      '404': { $ref: '#/components/responses/NotFound' },
      '409': { $ref: '#/components/responses/Conflict' },
      '503': { description: 'Fila ou worker indisponível.' },
    },
  },
  'GET /v1/transcriptions/{jobId}': {
    summary: 'Consultar transcrição',
    description: 'Consulta o estado e o resultado de um job de transcrição.',
    responses: {
      '200': { description: 'Estado atual do job.' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },
  'POST /v1/transcriptions/{jobId}/retry': {
    summary: 'Reenfileirar transcrição',
    description: 'Reenfileira jobs que terminaram em falha ou jobs em fila/processamento sem atualização além de TRANSCRIPTION_STALE_JOB_SECONDS.',
    responses: {
      '202': { description: 'Job reenfileirado.' },
      '404': { $ref: '#/components/responses/NotFound' },
      '409': { $ref: '#/components/responses/Conflict' },
    },
  },
  'DELETE /v1/transcriptions/{jobId}': {
    summary: 'Excluir transcrição individual',
    description: 'Exclui qualquer job de transcrição. Jobs em fila ou processamento são cancelados de forma durável; resultados atrasados do worker são ignorados. Em uploads diretos, remove também o áudio temporário do MinIO; em mídias de mensagens, remove somente o resultado e preserva a mídia original.',
    responses: {
      '200': {
        description: 'Transcrição excluída.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['id', 'deleted', 'cancelled', 'sourceRemoved', 'sourceRetained'],
              properties: {
                id: { type: 'string' },
                deleted: { type: 'boolean' },
                cancelled: { type: 'boolean' },
                sourceRemoved: { type: 'boolean' },
                sourceRetained: { type: 'boolean' },
              },
            },
          },
        },
      },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
      '409': { $ref: '#/components/responses/Conflict' },
      '503': { description: 'MinIO ou banco indisponível.' },
    },
  },
  'GET /chat/findPublishedStatuses/{instanceName}': {
    summary: 'Listar Status publicados por instância',
    description: 'Lista os Status enviados pela instância, sem incluir Status recebidos. O histórico é lido do armazenamento da própria instância.',
    parameters: [
      { name: 'instanceName', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 } },
    ],
    responses: {
      '200': { description: 'Status publicados da instância.' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },
  'GET /chat/findPublishedStatusViews/{instanceName}/{statusId}': {
    summary: 'Consultar visualizações de Status publicado',
    description: 'Retorna somente confirmações READ/PLAYED recebidas para um Status próprio ainda presente no histórico desta instância. Não consulta dados antigos que o WhatsApp/provider não tenha sincronizado.',
    parameters: [
      { name: 'instanceName', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'statusId', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' } },
    ],
    responses: {
      '200': { description: 'Lista de participantes com confirmação de visualização.' },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },
  'DELETE /chat/deleteStatus/{instanceName}/{statusId}': {
    summary: 'Excluir Status publicado',
    description: 'Solicita a revogação do Status no WhatsApp e remove/atualiza seu registro local conforme a política de retenção.',
    parameters: [
      { name: 'instanceName', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'statusId', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 128 } },
    ],
    responses: {
      '200': { description: 'Status excluído.' },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },
  ...localTemplateOperations,
  ...diagnosticOperations,
  ...videoCallOperations,
  ...findHubOperations,
  'GET /operations/statistics': operationsStatisticsOperation,
  "GET /operations/snapshot": {"summary": "Resumo operacional privado", "description": "Exige a API key global. Somente verificações técnicas, sem canais ou conteúdo de mensagens. Retorna 503 quando o monitoramento está desabilitado ou indisponível."},
  "GET /operations/history": {"summary": "Consultar histórico operacional", "description": "Lê registros recentes e arquivos compactados sem restaurar dados no banco. Somente administrador da instalação.", "parameters": [{"name": "from", "in": "query", "required": true, "schema": {"type": "string"}, "description": "Primeiro dia inclusivo, YYYY-MM-DD."}, {"name": "to", "in": "query", "required": true, "schema": {"type": "string"}, "description": "Último dia inclusivo, intervalo máximo de 31 dias."}, {"name": "cursor", "in": "query", "required": false, "schema": {"type": "string"}, "description": "Cursor de paginação retornado pela consulta anterior."}, {"name": "limit", "in": "query", "required": false, "schema": {"type": "string"}, "description": "Número de eventos por página, de 1 a 200."}]},
  "GET /operations/archives": {"summary": "Listar arquivos diários", "description": "Índice de dias disponíveis, tamanhos e verificação. Sem conteúdo do WhatsApp."},
  "GET /operations/export": {"summary": "Baixar diagnóstico compactado", "description": "Exportação administrativa de um único dia, sem credenciais ou conteúdo de comunicação.", "parameters": [{"name": "day", "in": "query", "required": true, "schema": {"type": "string", "format": "date"}}, {"name": "format", "in": "query", "schema": {"type": "string", "enum": ["text", "jsonl"], "default": "text"}}], "responses": {"200": {"description": "Arquivo GZIP de texto legível ou JSONL.", "content": {"application/gzip": {"schema": {"type": "string", "format": "binary"}}}}}},
  'GET /manager-api/v1/embedding': {
    summary: 'Consultar origens autorizadas do Manager',
    description: 'Configuração administrativa global do iframe. A configuração persistida no banco prevalece sobre o bootstrap do ambiente. Exige exclusivamente a API key global.',
    responses: {
      '200': { description: 'Política efetiva de incorporação.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerEmbeddingSettings' } } } },
      '403': { description: 'Acesso administrativo necessário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      '503': { description: 'Configuração temporariamente indisponível.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  'PUT /manager-api/v1/embedding': {
    summary: 'Atualizar origens autorizadas do Manager',
    description: 'Persiste até 12 origens HTTPS exatas. Não aceita caminhos, credenciais ou curingas. Usa versão otimista para impedir sobrescrita concorrente. Exige exclusivamente a API key global.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerEmbeddingUpdateRequest' } } },
    },
    responses: {
      '200': { description: 'Política de incorporação atualizada.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerEmbeddingSettings' } } } },
      '400': { $ref: '#/components/responses/BadRequest' },
      '403': { description: 'Acesso administrativo necessário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      '409': { description: 'Versão concorrente da configuração.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      '503': { description: 'Configuração temporariamente indisponível.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  'GET /manager-api/v1/storage/overview': {
    summary: 'Consultar uso do armazenamento MinIO',
    description: 'Relatório administrativo somente leitura do bucket S3/MinIO e das mídias persistidas. Com `instanceId`, os totais de mídia e objetos gerenciados ficam restritos à instância; objetos fora do prefixo proprietário continuam apenas como diagnóstico. Exige exclusivamente a API key global.',
    parameters: [{ name: 'instanceId', in: 'query', required: false, schema: { type: 'string', minLength: 1 }, description: 'ID da instância para o relatório individual.' }],
    responses: {
      '200': { description: 'Uso global ou individual do armazenamento.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerStorageOverview' } } } },
      '403': { description: 'Acesso administrativo necessário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      '404': { $ref: '#/components/responses/NotFound' },
      '503': { description: 'MinIO temporariamente indisponível.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  'POST /manager-api/v1/storage/cleanup/preview': {
    summary: 'Pré-visualizar limpeza segura de status',
    description: 'Prepara um plano efêmero, sem apagar nada. A única categoria automatizável é `status-broadcast`; mensagens, mídia gerenciada e escopo da instância são revalidados na execução.',
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerStorageCleanupPreviewRequest' } } } },
    responses: {
      '200': { description: 'Plano de limpeza com candidatos e prazo de expiração.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerStorageCleanupPreview' } } } },
      '400': { $ref: '#/components/responses/BadRequest' },
      '403': { description: 'Acesso administrativo necessário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      '409': { description: 'Recurso não suportado para limpeza automática.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  'POST /manager-api/v1/storage/cleanup': {
    summary: 'Executar limpeza segura confirmada',
    description: 'Executa somente um plano ainda válido e confirmado explicitamente. Nunca apaga objetos não referenciados, sessões ou recursos que não sejam `status-broadcast`.',
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerStorageCleanupRequest' } } } },
    responses: {
      '200': { description: 'Resultado detalhado da limpeza.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ManagerStorageCleanupResult' } } } },
      '400': { $ref: '#/components/responses/BadRequest' },
      '403': { description: 'Acesso administrativo necessário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      '409': { description: 'Plano expirado ou inválido.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  'POST /instance/create': {
    summary: 'Criar instância',
    description: 'Cria uma nova instância e retorna token, estado e QR/pairing quando solicitado. Em providers WhatsApp, grupos e status/broadcast começam ignorados (`groupsIgnore=true`, `readStatus=false`); a política pode ser alterada depois no Manager. Instâncias existentes não são reescritas.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateInstanceRequest' },
          examples: { baileys: { summary: 'WHATSAPP-BAILEYS', value: { instanceName: 'minha-instancia', integration: 'WHATSAPP-BAILEYS', qrcode: true } } },
        },
      },
    },
  },
  'GET /instance/connect/{instanceName}': {
    summary: 'Conectar instância',
    description: 'Obtém QR Code ou, quando `number` é informado, código de pareamento para a instância.',
    parameters: [{ name: 'number', in: 'query', required: false, schema: { type: 'string' }, description: 'Telefone internacional somente com dígitos para gerar código de pareamento.' }],
  },
  'DELETE /instance/delete/{instanceName}': { summary: 'Excluir instância definitivamente', description: 'Remove a instância e os dados persistidos associados segundo o ciclo de limpeza atual.' },
  'POST /instance/migrateProvider/{instanceName}': {
    summary: 'Converter provider da sessão',
    description: 'Converte uma sessão pareada entre WHATSAPP-BAILEYS e WHATSAPP-ZAPO por snapshot. A operação fecha o provider de origem sem logout, converte o estado, valida o destino e restaura a origem automaticamente se a nova sessão não abrir. Use `dryRun: true` para validar perdas sem interromper a conexão.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ProviderMigrationRequest' },
          examples: {
            toZapo: { summary: 'Baileys → Zapo', value: { targetProvider: 'WHATSAPP-ZAPO' } },
            toBaileys: { summary: 'Zapo → Baileys', value: { targetProvider: 'WHATSAPP-BAILEYS' } },
            dryRun: { summary: 'Somente validar conversão', value: { targetProvider: 'WHATSAPP-ZAPO', dryRun: true } },
          },
        },
      },
    },
  },
  'POST /message/sendText/{instanceName}': {
    summary: 'Enviar mensagem de texto',
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendTextRequest' }, example: { number: '5575999999999', text: 'Olá pelo Connect|API' } } } },
  },
  'POST /message/sendMedia/{instanceName}': {
    summary: 'Enviar mídia',
    description: 'Aceita payload JSON compatível e multipart/form-data com campo `file`.',
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: { number: { type: 'string' }, mediatype: { type: 'string', enum: ['image', 'video', 'document'] }, mimetype: { type: 'string' }, caption: { type: 'string' }, fileName: { type: 'string' }, file: { type: 'string', format: 'binary' } },
            required: ['number', 'file'],
          },
        },
        'application/json': { schema: { type: 'object', additionalProperties: true } },
      },
    },
  },
  'POST /chat/markMessageAsRead/{instanceName}': { summary: 'Marcar mensagem como lida', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageKeyRequest' } } } } },
  'POST /chat/markMessageAsPlayed/{instanceName}': {
    summary: 'Marcar áudio recebido como reproduzido (PLAYED)',
    description: 'Envia o receipt nativo PLAYED ao WhatsApp somente quando o cliente confirma reprodução real do áudio. Não substitui markMessageAsRead, não é disparado por download, histórico ou sincronização e aceita participant opcional para grupos. fromMe deve ser false.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PlayedMessageRequest' },
          example: {
            playedMessages: [
              {
                id: '3EB0123456789ABCDEF',
                fromMe: false,
                remoteJid: '5575988881111@s.whatsapp.net',
              },
            ],
          },
        },
      },
    },
    responses: {
      '201': {
        description: 'Receipt PLAYED enviado.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/PlayedMessageResult' } } },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },
  'GET /health': { summary: 'Healthcheck da API', security: [] },
  'GET /': { summary: 'Informações da API', security: [] },
  'POST /verify-creds': { summary: 'Validar credenciais da API' },
  'GET /compat/meta/{instanceName}': {
    summary: 'Consultar Meta Compatible',
    description: 'Retorna a identidade Graph derivada da instância e a configuração opcional do webhook Meta Compatible.',
    responses: {
      '200': { description: 'Identidade Meta Compatible da instância.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaCompatibilityConfig' } } } },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },
  'PUT /compat/meta/{instanceName}': {
    summary: 'Configurar Meta Compatible',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/MetaCompatibilityUpdateRequest' },
          example: { webhookUrl: 'https://example.com/webhooks/meta' },
        },
      },
    },
    responses: {
      '200': { description: 'Configuração Meta Compatible atualizada.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaCompatibilityConfig' } } } },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },
};

function mergeOperation(base, override = {}) {
  const merged = { ...base, ...override };
  if (base.parameters || override.parameters) {
    const parameters = [...(base.parameters || [])];
    for (const param of override.parameters || []) {
      const index = parameters.findIndex((p) => p.name === param.name && p.in === param.in);
      if (index >= 0) parameters[index] = { ...parameters[index], ...param };
      else parameters.push(param);
    }
    merged.parameters = parameters;
  }
  return merged;
}

function nativeSpec(routes, version) {
  const paths = {};
  for (const route of routes.filter((r) => !r.apiPath.startsWith('/graph/'))) {
    const key = `${route.method.toUpperCase()} ${route.apiPath}`;
    const params = pathParameters(route.apiPath);
    const successDescription = route.method === 'post' ? 'Operação aceita/criada com sucesso.' : 'Operação concluída com sucesso.';
    const base = {
      tags: [tagFromPath(route.apiPath, route.sourceFile)],
      summary: humanize(route.operation),
      operationId: operationId(route.method, route.apiPath),
      description: `Endpoint descoberto do código em \`${route.sourceFile}\`.`,
      parameters: params.length ? params : undefined,
      security: route.apiPath === '/' || route.apiPath === '/health' ? [] : [{ apiKey: [] }],
      responses: {
        '200': { description: successDescription, content: { 'application/json': { schema: { $ref: '#/components/schemas/GenericResponse' } } } },
        '201': { description: successDescription, content: { 'application/json': { schema: { $ref: '#/components/schemas/GenericResponse' } } } },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': { $ref: '#/components/responses/NotFound' },
      },
      'x-source-file': route.sourceFile,
    };
    if (route.method !== 'get' && route.apiPath !== '/verify-creds') {
      base.requestBody = { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } };
    }
    const operation = mergeOperation(base, requestOverrides[key]);
    Object.keys(operation).forEach((prop) => operation[prop] === undefined && delete operation[prop]);
    paths[route.apiPath] ||= {};
    paths[route.apiPath][route.method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Connect|API — REST API',
      version,
      summary: 'Referência interativa da API nativa do Connect|API.',
      description: [
        '![Connect|API REST](openapi/branding/docs/connect-api-rest-light.png)', '',
        'API nativa do Connect|API. Pode coexistir com a fachada Meta Compatible `/graph`.', '',
        '### Autenticação', 'A API nativa usa o header `apikey`. Instâncias podem utilizar a chave global configurada ou o token próprio, conforme os guards da aplicação.', '',
        '### Providers', '- `WHATSAPP-BUSINESS`', '- `WHATSAPP-BAILEYS`', '- `WHATSAPP-ZAPO`', '- `GOOGLE-FIND-HUB`', '',
        '### Atualização automática', 'Este documento é materializado por `docs/scripts/generate-openapi.mjs`. Alterações de rotas fazem o `Docs Integrity` falhar até o contrato ser regenerado e versionado.',
      ].join('\n'),
    },
    servers: [{ url: 'https://d.api.connect.argws.com.br', description: 'Develop / homologação' }, { url: 'http://localhost:38080', description: 'Docker local' }],
    tags: [
      { name: 'Google Find Hub', description: 'Contas Google, autenticação por CredentialProvider, dispositivos, localização, tracking e Traccar. Consulte também o documento dedicado Google Find Hub no seletor do Scalar.' },
      { name: 'Core', description: 'Healthcheck, descoberta e utilidades globais.' }, { name: 'Instances', description: 'Criação, conexão, estado, logout, restart e exclusão.' },
      { name: 'Messages', description: 'Texto, mídia, áudio, PTV, sticker, localização, contatos, reações, enquetes, listas e botões.' },
      { name: 'Chats & Contacts', description: 'Chats, contatos, mensagens persistidas, perfil, presença e privacidade.' }, { name: 'Groups', description: 'Criação e administração de grupos.' },
      { name: 'Business', description: 'Recursos business suportados pelo provider.' }, { name: 'Calls', description: 'Recursos de chamadas.' }, { name: 'Templates', description: 'Templates oficiais quando suportados.' }, { name: 'Local Templates', description: 'Modelos locais persistidos por instância ZAPO/Baileys; não são aprovação Meta.' },
      { name: 'Settings', description: 'Configurações por instância.' }, { name: 'Proxy', description: 'Proxy por instância.' }, { name: 'Labels', description: 'Labels e associações.' },
      { name: 'Webhooks', description: 'Configuração e recebimento de webhooks.' }, { name: 'WebSocket', description: 'Eventos via WebSocket.' }, { name: 'RabbitMQ', description: 'Eventos via RabbitMQ.' },
      { name: 'NATS', description: 'NATS opcional.' }, { name: 'Pusher', description: 'Pusher opcional.' }, { name: 'SQS', description: 'AWS SQS opcional.' }, { name: 'Kafka', description: 'Kafka opcional.' },
      { name: 'Storage', description: 'Mídia e armazenamento S3/MinIO.' }, { name: 'Chatbots', description: 'Integrações de chatbot/automação.' }, { name: 'Channels', description: 'Rotas específicas de canais/providers.' },
      { name: 'Meta Compatible Admin', description: 'Identidade e configuração opcional de webhook da fachada Meta Compatible.' },
      { name: 'Diagnostics', description: 'Diagnóstico técnico nativo, histórico e download privado sem conversas. Exige exclusivamente a chave global de administração.' },
      { name: 'Manager', description: 'Recursos administrativos globais do Manager, incluindo a allowlist persistida de origens de iframe e a observabilidade protegida do armazenamento MinIO.' },
    ],
    paths,
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'apikey', description: 'Chave global da API ou token autorizado da instância.' } },
      schemas: {
        ...metaCompatibilityAdminSchemas,
        ...localTemplateSchemas,
        ...diagnosticSchemas,
        ...videoCallSchemas,
        ...findHubSchemas,
        ManagerEmbeddingSettings: {
          type: 'object',
          additionalProperties: false,
          required: ['version', 'configured', 'enabled', 'allowedOrigins', 'effectiveFrameAncestors', 'source', 'allowAnyOrigin'],
          properties: {
            version: { type: 'integer', minimum: 1 },
            configured: { type: 'boolean' },
            enabled: { type: 'boolean' },
            allowedOrigins: { type: 'array', maxItems: 12, items: { type: 'string', format: 'uri' } },
            effectiveFrameAncestors: { type: 'string' },
            source: { type: 'string', enum: ['database', 'environment'] },
            allowAnyOrigin: { type: 'boolean' },
            updatedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        ManagerEmbeddingUpdateRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['version', 'enabled', 'allowedOrigins'],
          properties: {
            version: { type: 'integer', minimum: 1 },
            enabled: { type: 'boolean' },
            allowedOrigins: { type: 'array', maxItems: 12, items: { type: 'string', format: 'uri' } },
          },
        },
        ManagerStorageResource: {
          type: 'object',
          required: ['key', 'label', 'objectCount', 'mediaCount', 'bytes', 'cleanable'],
          properties: {
            key: { type: 'string' }, label: { type: 'string' }, objectCount: { type: 'integer', minimum: 0 },
            mediaCount: { type: 'integer', minimum: 0 }, bytes: { type: 'integer', minimum: 0 }, cleanable: { type: 'boolean' }, note: { type: 'string' },
          },
        },
        ManagerStorageOverview: {
          type: 'object',
          required: ['enabled', 'bucket', 'managedPrefix', 'generatedAt', 'truncated', 'objectCount', 'totalBytes', 'managedObjectCount', 'managedBytes', 'untrackedObjectCount', 'untrackedBytes', 'databaseMediaCount', 'missingObjectCount', 'resources', 'instances', 'cleanup'],
          properties: {
            enabled: { type: 'boolean' }, bucket: { type: ['string', 'null'] }, managedPrefix: { type: 'string' }, generatedAt: { type: 'string', format: 'date-time' }, truncated: { type: 'boolean' },
            objectCount: { type: 'integer', minimum: 0 }, totalBytes: { type: 'integer', minimum: 0 }, managedObjectCount: { type: 'integer', minimum: 0 }, managedBytes: { type: 'integer', minimum: 0 },
            untrackedObjectCount: { type: 'integer', minimum: 0 }, untrackedBytes: { type: 'integer', minimum: 0 }, databaseMediaCount: { type: 'integer', minimum: 0 }, missingObjectCount: { type: 'integer', minimum: 0 },
            resources: { type: 'array', items: { $ref: '#/components/schemas/ManagerStorageResource' } },
            instances: { type: 'array', items: { type: 'object', required: ['id', 'name', 'databaseMediaCount', 'objectCount', 'bytes', 'missingObjectCount'], properties: { id: { type: 'string' }, name: { type: 'string' }, databaseMediaCount: { type: 'integer' }, objectCount: { type: 'integer' }, bytes: { type: 'integer' }, missingObjectCount: { type: 'integer' } } } },
            cleanup: { type: 'object', required: ['supportedResources', 'policy'], properties: { supportedResources: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, safe: { type: 'boolean' } } } }, policy: { type: 'string' } } },
          },
        },
        ManagerStorageCleanupPreviewRequest: {
          type: 'object', additionalProperties: false,
          properties: { scope: { type: 'string', enum: ['global', 'instance'], default: 'global' }, instanceId: { type: 'string' }, resource: { type: 'string', enum: ['status-broadcast'], default: 'status-broadcast' }, olderThanDays: { type: 'integer', minimum: 0, maximum: 3650, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        },
        ManagerStorageCleanupPreview: {
          type: 'object', required: ['planId', 'expiresAt', 'scope', 'resource', 'count', 'bytes', 'candidates', 'warning'],
          properties: { planId: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' }, scope: { type: 'string' }, instanceId: { type: ['string', 'null'] }, resource: { type: 'string' }, count: { type: 'integer' }, bytes: { type: 'integer' }, candidates: { type: 'array', items: { type: 'object', additionalProperties: true } }, warning: { type: 'string' } },
        },
        ManagerStorageCleanupRequest: { type: 'object', additionalProperties: false, required: ['planId', 'confirm'], properties: { planId: { type: 'string', minLength: 1 }, confirm: { type: 'boolean', const: true } } },
        ManagerStorageCleanupResult: { type: 'object', required: ['status', 'requested', 'removed', 'skipped', 'failed', 'freedBytes', 'failures'], properties: { status: { type: 'string', enum: ['completed', 'partial'] }, requested: { type: 'integer' }, removed: { type: 'integer' }, skipped: { type: 'integer' }, failed: { type: 'integer' }, freedBytes: { type: 'integer' }, failures: { type: 'array', items: { type: 'string' } } } },
        TranscriptionJob: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'provider', 'model', 'status', 'attempts', 'createdAt', 'updatedAt'],
          properties: {
            id: { type: 'string' },
            instanceId: { type: ['string', 'null'] },
            messageId: { type: ['string', 'null'] },
            provider: { type: 'string', example: 'local' },
            model: { type: 'string', example: 'Xenova/whisper-small' },
            language: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
            text: { type: ['string', 'null'] },
            detectedLanguage: { type: ['string', 'null'] },
            durationMs: { type: ['integer', 'null'], minimum: 0 },
            segments: { type: ['array', 'null'], items: { type: 'object', additionalProperties: true } },
            errorCode: { type: ['string', 'null'] },
            errorMessage: { type: ['string', 'null'] },
            attempts: { type: 'integer', minimum: 1 },
            createdAt: { type: 'string', format: 'date-time' },
            startedAt: { type: ['string', 'null'], format: 'date-time' },
            completedAt: { type: ['string', 'null'], format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        GenericResponse: { type: 'object', additionalProperties: true },
        ErrorResponse: { type: 'object', additionalProperties: true, properties: { status: { type: ['integer', 'string', 'null'] }, error: { type: ['string', 'boolean', 'object', 'null'] }, message: { type: ['string', 'array', 'null'] } } },
        CreateInstanceRequest: { type: 'object', properties: { instanceName: { type: 'string' }, integration: { type: 'string', enum: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO', 'GOOGLE-FIND-HUB'] }, token: { type: 'string' }, number: { type: 'string' }, qrcode: { type: 'boolean' }, syncFullHistory: { type: 'boolean' } }, required: ['instanceName'], additionalProperties: true },
        ProviderMigrationRequest: { type: 'object', properties: { targetProvider: { type: 'string', enum: ['WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'] }, dryRun: { type: 'boolean', default: false } }, required: ['targetProvider'], additionalProperties: false },
        SendTextRequest: { type: 'object', properties: { number: { type: 'string' }, text: { type: 'string' }, delay: { type: 'integer', minimum: 0 }, linkPreview: { type: 'boolean' }, mentionsEveryOne: { type: 'boolean' }, mentioned: { type: 'array', items: { type: 'string' } }, quoted: { type: 'object', additionalProperties: true } }, required: ['number', 'text'], additionalProperties: true },
        MessageKeyRequest: { type: 'object', properties: { readMessages: { type: 'array', items: { type: 'object', properties: { remoteJid: { type: 'string' }, fromMe: { type: 'boolean' }, id: { type: 'string' } }, required: ['remoteJid', 'id'] } } }, additionalProperties: true },
        PlayedMessageRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['playedMessages'],
          properties: {
            playedMessages: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'fromMe', 'remoteJid'],
                properties: {
                  id: { type: 'string', minLength: 1 },
                  fromMe: { type: 'boolean', const: false },
                  remoteJid: { type: 'string', minLength: 1 },
                  participant: { type: 'string', minLength: 1 },
                },
              },
            },
          },
        },
        PlayedMessageResult: {
          type: 'object',
          additionalProperties: false,
          required: ['success', 'receipt', 'processed'],
          properties: {
            success: { const: true },
            receipt: { const: 'played' },
            processed: { type: 'integer', minimum: 1 },
          },
        },
      },
      responses: {
        BadRequest: { description: 'Requisição inválida.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Unauthorized: { description: 'Credencial inválida ou ausente.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        NotFound: { description: 'Recurso ou instância não encontrado.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      },
    },
  };
}

function findHubSpec(native, version) {
  return {
    ...native,
    info: {
      title: 'Connect|API — Google Find Hub', version,
      summary: 'Implantação, autenticação, dispositivos, localização e Traccar.',
      description: fs.readFileSync(path.join(ROOT, 'docs', 'guides', 'google-find-hub.md'), 'utf8'),
    },
    tags: native.tags.filter((tag) => tag.name === 'Google Find Hub'),
    paths: Object.fromEntries(Object.entries(native.paths).filter(([apiPath]) => apiPath.startsWith('/findhub/'))),
  };
}

function graphSpec(version) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Connect|API — Meta Compatible /graph', version, summary: 'Fachada HTTP/Webhook compatível com o contrato Meta WhatsApp Cloud.',
      description: [
        '![Connect|API Meta](openapi/branding/docs/connect-api-meta-light.png)', '',
        'Fachada Meta Compatible sobre o mesmo núcleo do Connect|API, sem provider paralelo e sem `wamid` artificial.', '',
        'A autenticação usa `Authorization: Bearer <INSTANCE_TOKEN>`. Toda instância compatível com identidade telefônica estável é Graph-addressable por padrão.',
      ].join('\n'),
    },
    servers: [{ url: 'https://d.api.connect.argws.com.br/graph', description: 'Develop / homologação' }, { url: 'http://localhost:38080/graph', description: 'Docker local' }],
    tags: [{ name: 'Messages' }, { name: 'Media' }, { name: 'Status' }, { name: 'Transcription' }, { name: 'Templates' }],
    paths: {
      '/{version}/{phoneNumberId}/messages': {
        post: {
          tags: ['Messages'], summary: 'Enviar mensagem compatível com Meta', operationId: 'meta_send_message', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaMessageRequest' }, examples: { template: { value: { messaging_product: 'whatsapp', to: '5575999999999', type: 'template', template: { name: 'hello', language: { code: 'pt_BR' }, components: [] } } }, text: { value: { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5575999999999', type: 'text', text: { body: 'Olá pelo /graph' } } }, reaction: { value: { messaging_product: 'whatsapp', to: '5575999999999', type: 'reaction', reaction: { message_id: 'REAL_PROVIDER_ID', emoji: '👍' } } }, read: { value: { messaging_product: 'whatsapp', status: 'read', message_id: 'REAL_PROVIDER_ID' } } } } } },
          responses: { '200': { description: 'Mensagem enviada ou leitura confirmada.', content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/MetaMessageResponse' }, { $ref: '#/components/schemas/MetaReadReceiptResponse' }] } } } }, '400': { $ref: '#/components/responses/GraphError' }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' }, '409': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/media': {
        post: {
          tags: ['Media'], summary: 'Upload temporário de mídia', operationId: 'meta_upload_media', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/MetaMediaUploadRequest' } } } },
          responses: { '200': { description: 'Mídia recebida para uso temporário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaMediaUploadResponse' } } } }, '400': { $ref: '#/components/responses/GraphError' }, '401': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/status': {
        post: {
          tags: ['Status'], summary: 'Publicar Status do WhatsApp', operationId: 'meta_publish_status', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaStatusRequest' } }, 'multipart/form-data': { schema: { $ref: '#/components/schemas/MetaStatusRequest' } } } },
          responses: { '200': { description: 'Status aceito pelo provider.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaStatusResponse' } } } }, '400': { $ref: '#/components/responses/GraphError' }, '401': { $ref: '#/components/responses/GraphError' }, '409': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/statuses': {
        get: {
          tags: ['Status'], summary: 'Listar Status publicados pela instância', operationId: 'meta_list_statuses', security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' },
            { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 } },
          ],
          responses: { '200': { description: 'Status publicados da instância, sem conteúdo binário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaStatusListResponse' } } } }, '401': { $ref: '#/components/responses/GraphError' }, '409': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/statuses/{statusId}': {
        delete: {
          tags: ['Status'], summary: 'Excluir Status publicado pela instância', operationId: 'meta_delete_status', security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' },
            { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'statusId', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' } },
          ],
          responses: { '200': { description: 'Status excluído no provider e no histórico local.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaStatusDeleteResponse' } } } }, '400': { $ref: '#/components/responses/GraphError' }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' }, '409': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/statuses/{statusId}/views': {
        get: {
          tags: ['Status'], summary: 'Consultar visualizações de Status publicado', operationId: 'meta_get_status_views', security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' },
            { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'statusId', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' } },
          ],
          responses: { '200': { description: 'Visualizações READ/PLAYED conhecidas localmente pela instância.' }, '400': { $ref: '#/components/responses/GraphError' }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' }, '409': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/transcriptions': {
        post: {
          tags: ['Transcription'], summary: 'Solicitar transcrição assíncrona de áudio', operationId: 'meta_create_transcription', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaTranscriptionRequest' } }, 'multipart/form-data': { schema: { $ref: '#/components/schemas/MetaTranscriptionUploadRequest' } } } },
          responses: { '202': { description: 'Job de transcrição criado.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaTranscriptionResponse' } } } }, '400': { $ref: '#/components/responses/GraphError' }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' }, '415': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/transcriptions/{jobId}': {
        get: {
          tags: ['Transcription'], summary: 'Consultar job de transcrição', operationId: 'meta_get_transcription', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Estado atual do job.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaTranscriptionJob' } } } }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' } },
        },
        delete: {
          tags: ['Transcription'], summary: 'Excluir job de transcrição', operationId: 'meta_delete_transcription', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Job excluído.', content: { 'application/json': { schema: { type: 'object', properties: { messaging_product: { type: 'string', example: 'whatsapp' }, id: { type: 'string' }, deleted: { type: 'boolean' }, cancelled: { type: 'boolean' }, source_removed: { type: 'boolean' }, source_retained: { type: 'boolean' } }, required: ['messaging_product', 'id', 'deleted'] } } } }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' }, '409': { $ref: '#/components/responses/GraphError' }, '503': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{phoneNumberId}/transcriptions/{jobId}/retry': {
        post: {
          tags: ['Transcription'], summary: 'Reenfileirar job de transcrição com falha', operationId: 'meta_retry_transcription', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '202': { description: 'Job reenfileirado.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaTranscriptionJob' } } } }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' }, '409': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{businessAccountId}/message_templates': {
        get: {
          tags: ['Templates'], summary: 'Listar templates', operationId: 'meta_list_templates', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'businessAccountId', in: 'path', required: true, schema: { type: 'string' } }, ...localTemplatePagination],
          responses: { '200': { description: 'Business: catálogo oficial. ZAPO/Baileys: catálogo local persistido, paginado, source=connectapi_local e status LOCAL_READY/LOCAL_DISABLED. Não representa aprovação Meta.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaTemplateListResponse' } } } }, '401': { $ref: '#/components/responses/GraphError' } },
        },
      },
      '/{version}/{mediaId}': {
        get: {
          tags: ['Media'], summary: 'Resolver mídia recebida', operationId: 'meta_get_media', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'mediaId', in: 'path', required: true, schema: { type: 'string', description: 'ID real da mensagem/provider usado como media id.' } }],
          responses: { '200': { description: 'Metadados e URL presigned segura.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaMediaResponse' } } } }, '401': { $ref: '#/components/responses/GraphError' }, '404': { $ref: '#/components/responses/GraphError' } },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Instance token', description: 'Token real da instância correspondente ao recurso Graph.' } },
      schemas: metaCompatibleSchemas,
      responses: { GraphError: { description: 'Erro em formato Graph.', content: { 'application/json': { schema: { $ref: '#/components/schemas/GraphError' } } } } },
    },
  };
}

function asyncSpec(version) {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'api', 'types', 'wa.types.ts'), 'utf8');
  const enumMatch = source.match(/export\s+enum\s+Events\s*\{([\s\S]*?)\n\}/m);
  const events = [];
  if (enumMatch) for (const match of enumMatch[1].matchAll(/[A-Z0-9_]+\s*=\s*['"]([^'"]+)['"]/g)) events.push(match[1]);
  const channels = {};
  const findHubMessages = {};
  for (const event of events) {
    channels[event] = {
      description: `Evento \`${event}\` do Connect|API. A disponibilidade externa depende do transporte habilitado na instância.`,
      subscribe: { operationId: `consume_${event.replace(/[^A-Za-z0-9]+/g, '_')}`, message: { $ref: '#/components/messages/ConnectEvent' } },
    };
  }
  for (const [event, definition] of Object.entries(findHubEventMessages)) {
    if (!channels[event]) continue;
    const messageName = event.replace(/[^A-Za-z0-9]+/g, '_');
    channels[event].description = definition.description;
    channels[event].subscribe.message = { $ref: `#/components/messages/${messageName}` };
    findHubMessages[messageName] = {
      name: messageName, title: event,
      payload: { type: 'object', additionalProperties: true, properties: {
        event: { type: 'string' }, instance: {}, data: definition.data,
      } },
    };
  }
  return {
    asyncapi: '2.6.0',
    info: {
      title: 'Connect|API — Eventos',
      version,
      description: [
        '![Connect|API Events](openapi/branding/docs/connect-api-events-light.png)', '',
        'Eventos do Connect|API publicáveis por Webhook, WebSocket, RabbitMQ, NATS, SQS, Pusher ou Kafka conforme configuração e suporte.',
      ].join('\n'),
    },
    channels,
    components: { messages: { ...findHubMessages, ConnectEvent: { name: 'ConnectEvent', title: 'Evento Connect|API', payload: { type: 'object', additionalProperties: true, properties: { event: { type: 'string' }, instance: {}, data: {} } } } } },
  };
}

function stableJson(value) { return JSON.stringify(value, null, 2) + '\n'; }

function writeOrCheck(file, content) {
  if (CHECK_MODE) {
    if (!fs.existsSync(file)) { console.error(`[docs] Missing generated file: ${path.relative(ROOT, file)}`); process.exitCode = 1; return; }
    if (fs.readFileSync(file, 'utf8') !== content) { console.error(`[docs] Stale generated file: ${path.relative(ROOT, file)}. Run npm run docs:generate.`); process.exitCode = 1; }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const routes = discoverRoutes();
const native = nativeSpec(routes, pkg.version);
const graph = graphSpec(pkg.version);
const findhub = findHubSpec(native, pkg.version);
const asyncapi = asyncSpec(pkg.version);
const coverage = {
  generatedAt: new Date().toISOString(), version: pkg.version,
  sourceDigest: crypto.createHash('sha256').update(routes.map((r) => `${r.method.toUpperCase()} ${r.apiPath} ${r.sourceFile}`).join('\n')).digest('hex'),
  operations: routes.filter((r) => !r.apiPath.startsWith('/graph/')).map((r) => ({ method: r.method.toUpperCase(), path: r.apiPath, source: r.sourceFile })),
  graphOperations: routes.filter((r) => r.apiPath.startsWith('/graph/')).map((r) => ({ method: r.method.toUpperCase(), path: r.apiPath, source: r.sourceFile })),
};

writeOrCheck(path.join(OUTPUT_DIR, 'connect-api.openapi.json'), stableJson(native));
writeOrCheck(path.join(OUTPUT_DIR, 'findhub.openapi.json'), stableJson(findhub));
writeOrCheck(path.join(OUTPUT_DIR, 'meta-compatible.openapi.json'), stableJson(graph));
writeOrCheck(path.join(ASYNC_DIR, 'connect-api-events.asyncapi.json'), stableJson(asyncapi));

const coverageFile = path.join(OUTPUT_DIR, 'coverage.json');
if (CHECK_MODE) {
  if (!fs.existsSync(coverageFile)) { console.error('[docs] Missing generated file: docs/openapi/coverage.json'); process.exitCode = 1; }
  else {
    const current = JSON.parse(fs.readFileSync(coverageFile, 'utf8')); delete current.generatedAt;
    const expected = { ...coverage }; delete expected.generatedAt;
    if (stableJson(current) !== stableJson(expected)) { console.error('[docs] Route coverage is stale. Run npm run docs:generate.'); process.exitCode = 1; }
  }
} else {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(coverageFile, stableJson(coverage));
}

if (!CHECK_MODE) console.log(`[docs] Generated ${Object.keys(native.paths).length} native paths, ${Object.keys(graph.paths).length} Graph paths and ${Object.keys(asyncapi.channels).length} event channels.`);
else if (!process.exitCode) console.log('[docs] OpenAPI/AsyncAPI contracts are synchronized with current route/event sources.');
