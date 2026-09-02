import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { metaCompatibleSchemas, metaCompatibilityAdminSchemas } from './meta-compatible-schemas.mjs';

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
    call: 'Calls', template: 'Templates', settings: 'Settings', proxy: 'Proxy', label: 'Labels', webhook: 'Webhooks',
    websocket: 'WebSocket', rabbitmq: 'RabbitMQ', nats: 'NATS', pusher: 'Pusher', sqs: 'SQS', kafka: 'Kafka',
    s3: 'Storage', storage: 'Storage', minio: 'Storage', chatbot: 'Chatbots', typebot: 'Chatbots', openai: 'Chatbots',
    dify: 'Chatbots', flowise: 'Chatbots', n8n: 'Chatbots', evoai: 'Chatbots', connectai: 'Chatbots',
    compat: 'Meta Compatible Admin',
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
  'POST /instance/create': {
    summary: 'Criar instância',
    description: 'Cria uma nova instância e retorna token, estado e QR/pairing quando solicitado.',
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
        '![Connect|API DOCs](/openapi/branding/docs/connect-api-docs-light.png)', '',
        'Documentação gerada a partir das rotas Express atuais do projeto. O contrato nativo continua sendo a interface principal da aplicação e pode coexistir com a camada Meta Compatible `/graph`.', '',
        '### Autenticação', 'A API nativa usa o header `apikey`. Instâncias podem utilizar a chave global configurada ou o token próprio, conforme os guards da aplicação.', '',
        '### Providers', '- `WHATSAPP-BUSINESS`', '- `WHATSAPP-BAILEYS`', '- `CONNECT`', '',
        '### Atualização automática', 'Este documento é materializado por `docs/scripts/generate-openapi.mjs`. Alterações de rotas fazem o `Docs Integrity` falhar até o contrato ser regenerado e versionado.',
      ].join('\n'),
    },
    servers: [{ url: 'https://d.api.connect.argws.com.br', description: 'Develop / homologação' }, { url: 'http://localhost:38080', description: 'Docker local' }],
    tags: [
      { name: 'Core', description: 'Healthcheck, descoberta e utilidades globais.' }, { name: 'Instances', description: 'Criação, conexão, estado, logout, restart e exclusão.' },
      { name: 'Messages', description: 'Texto, mídia, áudio, PTV, sticker, localização, contatos, reações, enquetes, listas e botões.' },
      { name: 'Chats & Contacts', description: 'Chats, contatos, mensagens persistidas, perfil, presença e privacidade.' }, { name: 'Groups', description: 'Criação e administração de grupos.' },
      { name: 'Business', description: 'Recursos business suportados pelo provider.' }, { name: 'Calls', description: 'Recursos de chamadas.' }, { name: 'Templates', description: 'Templates oficiais quando suportados.' },
      { name: 'Settings', description: 'Configurações por instância.' }, { name: 'Proxy', description: 'Proxy por instância.' }, { name: 'Labels', description: 'Labels e associações.' },
      { name: 'Webhooks', description: 'Configuração e recebimento de webhooks.' }, { name: 'WebSocket', description: 'Eventos via WebSocket.' }, { name: 'RabbitMQ', description: 'Eventos via RabbitMQ.' },
      { name: 'NATS', description: 'NATS opcional.' }, { name: 'Pusher', description: 'Pusher opcional.' }, { name: 'SQS', description: 'AWS SQS opcional.' }, { name: 'Kafka', description: 'Kafka opcional.' },
      { name: 'Storage', description: 'Mídia e armazenamento S3/MinIO.' }, { name: 'Chatbots', description: 'Integrações de chatbot/automação.' }, { name: 'Channels', description: 'Rotas específicas de canais/providers.' },
      { name: 'Meta Compatible Admin', description: 'Identidade e configuração opcional de webhook da fachada Meta Compatible.' },
    ],
    paths,
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'apikey', description: 'Chave global da API ou token autorizado da instância.' } },
      schemas: {
        ...metaCompatibilityAdminSchemas,
        GenericResponse: { type: 'object', additionalProperties: true },
        ErrorResponse: { type: 'object', additionalProperties: true, properties: { status: { type: ['integer', 'string', 'null'] }, error: { type: ['string', 'boolean', 'object', 'null'] }, message: { type: ['string', 'array', 'null'] } } },
        CreateInstanceRequest: { type: 'object', properties: { instanceName: { type: 'string' }, integration: { type: 'string', enum: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'CONNECT'] }, token: { type: 'string' }, number: { type: 'string' }, qrcode: { type: 'boolean' }, syncFullHistory: { type: 'boolean' } }, required: ['instanceName'], additionalProperties: true },
        SendTextRequest: { type: 'object', properties: { number: { type: 'string' }, text: { type: 'string' }, delay: { type: 'integer', minimum: 0 }, linkPreview: { type: 'boolean' }, mentionsEveryOne: { type: 'boolean' }, mentioned: { type: 'array', items: { type: 'string' } }, quoted: { type: 'object', additionalProperties: true } }, required: ['number', 'text'], additionalProperties: true },
        MessageKeyRequest: { type: 'object', properties: { readMessages: { type: 'array', items: { type: 'object', properties: { remoteJid: { type: 'string' }, fromMe: { type: 'boolean' }, id: { type: 'string' } }, required: ['remoteJid', 'id'] } } }, additionalProperties: true },
      },
      responses: {
        BadRequest: { description: 'Requisição inválida.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Unauthorized: { description: 'Credencial inválida ou ausente.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        NotFound: { description: 'Recurso ou instância não encontrado.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      },
    },
  };
}

function graphSpec(version) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Connect|API — Meta Compatible /graph', version, summary: 'Fachada HTTP/Webhook compatível com o contrato Meta WhatsApp Cloud.',
      description: 'A camada `/graph` é uma fachada de protocolo sobre o mesmo núcleo do Connect|API. Não cria provider paralelo, não cria `wamid` virtual e retorna o ID real do provider. A autenticação usa `Authorization: Bearer <INSTANCE_TOKEN>`. Toda instância compatível e com identidade telefônica estável é Graph-addressable por padrão.',
    },
    servers: [{ url: 'https://d.api.connect.argws.com.br/graph', description: 'Develop / homologação' }, { url: 'http://localhost:38080/graph', description: 'Docker local' }],
    tags: [{ name: 'Messages' }, { name: 'Media' }, { name: 'Templates' }],
    paths: {
      '/{version}/{phoneNumberId}/messages': {
        post: {
          tags: ['Messages'], summary: 'Enviar mensagem compatível com Meta', operationId: 'meta_send_message', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'phoneNumberId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaMessageRequest' }, examples: { text: { value: { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5575999999999', type: 'text', text: { body: 'Olá pelo /graph' } } }, reaction: { value: { messaging_product: 'whatsapp', to: '5575999999999', type: 'reaction', reaction: { message_id: 'REAL_PROVIDER_ID', emoji: '👍' } } }, read: { value: { messaging_product: 'whatsapp', status: 'read', message_id: 'REAL_PROVIDER_ID' } } } } } },
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
      '/{version}/{businessAccountId}/message_templates': {
        get: {
          tags: ['Templates'], summary: 'Listar templates', operationId: 'meta_list_templates', security: [{ bearerAuth: [] }],
          parameters: [{ name: 'version', in: 'path', required: true, schema: { type: 'string', pattern: '^v[0-9]+\\.[0-9]+$' }, example: 'v20.0' }, { name: 'businessAccountId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Lista Meta-shaped. WHATSAPP-BAILEYS e CONNECT retornam `data: []`.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaTemplateListResponse' } } } }, '401': { $ref: '#/components/responses/GraphError' } },
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
  for (const event of events) {
    channels[event] = {
      description: `Evento \`${event}\` do Connect|API. A disponibilidade externa depende do transporte habilitado na instância.`,
      subscribe: { operationId: `consume_${event.replace(/[^A-Za-z0-9]+/g, '_')}`, message: { $ref: '#/components/messages/ConnectEvent' } },
    };
  }
  return {
    asyncapi: '2.6.0',
    info: { title: 'Connect|API — Eventos', version, description: 'Catálogo dos eventos definidos em `Events`, publicáveis por Webhook, WebSocket, RabbitMQ, NATS, SQS, Pusher ou Kafka conforme configuração e suporte.' },
    channels,
    components: { messages: { ConnectEvent: { name: 'ConnectEvent', title: 'Evento Connect|API', payload: { type: 'object', additionalProperties: true, properties: { event: { type: 'string' }, instance: {}, data: {} } } } } },
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
const asyncapi = asyncSpec(pkg.version);
const coverage = {
  generatedAt: new Date().toISOString(), version: pkg.version,
  sourceDigest: crypto.createHash('sha256').update(routes.map((r) => `${r.method.toUpperCase()} ${r.apiPath} ${r.sourceFile}`).join('\n')).digest('hex'),
  operations: routes.filter((r) => !r.apiPath.startsWith('/graph/')).map((r) => ({ method: r.method.toUpperCase(), path: r.apiPath, source: r.sourceFile })),
  graphOperations: routes.filter((r) => r.apiPath.startsWith('/graph/')).map((r) => ({ method: r.method.toUpperCase(), path: r.apiPath, source: r.sourceFile })),
};

writeOrCheck(path.join(OUTPUT_DIR, 'connect-api.openapi.json'), stableJson(native));
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
