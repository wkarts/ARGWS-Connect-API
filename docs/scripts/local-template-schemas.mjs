const ref = name => ({ $ref: `#/components/schemas/${name}` });
const identity = {
  name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$', example: 'hello' },
  language: { type: 'string', pattern: '^[a-z]{2,3}(?:_[A-Z]{2})?$', example: 'pt_BR' },
};
const version = { type: 'integer', minimum: 1, description: 'Versão do cadastro. Alterações concorrentes retornam 409.' };
const components = { type: 'array', minItems: 1, maxItems: 3, items: ref('LocalTemplateComponent'), description: 'BODY obrigatório; HEADER/FOOTER opcionais e fixos. Somente BODY aceita variáveis consecutivas {{1}} a {{20}}. Total renderizado: até 4096 caracteres.' };

export const localTemplateSchemas = {
  LocalTemplateComponent: {
    oneOf: [
      { type: 'object', properties: { type: { const: 'BODY' }, text: { type: 'string', minLength: 1, maxLength: 4096 } }, required: ['type', 'text'], additionalProperties: false },
      { type: 'object', properties: { type: { const: 'HEADER' }, format: { const: 'TEXT' }, text: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['type', 'text'], additionalProperties: false },
      { type: 'object', properties: { type: { const: 'FOOTER' }, text: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['type', 'text'], additionalProperties: false },
    ],
  },
  LocalTemplateCreate: { type: 'object', properties: { ...identity, components, enabled: { type: 'boolean', default: true } }, required: ['name', 'language', 'components'], additionalProperties: false },
  LocalTemplateEdit: { type: 'object', properties: { ...identity, version, components, enabled: { type: 'boolean' } }, required: ['name', 'language', 'version'], anyOf: [{ required: ['components'] }, { required: ['enabled'] }], additionalProperties: false },
  LocalTemplateDelete: { type: 'object', properties: { ...identity, version }, required: ['name', 'language', 'version'], additionalProperties: false },
  LocalTemplate: {
    type: 'object', description: 'Template persistido por instância na Connect|API. O recurso é independente do consumidor; status APPROVED representa o estado canônico e enabled/available controlam a disponibilidade operacional.',
    properties: { id: { type: 'string' }, ...identity, version, components, enabled: { type: 'boolean' }, available: { type: 'boolean' }, status: { const: 'APPROVED' }, approved: { const: true }, source: { const: 'connectapi_local' }, execution: { const: 'rendered_text' }, category: { const: 'UTILITY' }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' } },
    required: ['id', 'name', 'language', 'components', 'version', 'enabled', 'available', 'status', 'approved', 'source', 'execution', 'category'],
  },
  LocalTemplateList: { type: 'object', properties: { data: { type: 'array', items: ref('LocalTemplate') }, paging: { type: 'object', properties: { cursors: { type: 'object', properties: { after: { type: 'string' } } }, next: { type: 'string', description: 'Referência relativa para a próxima página no mesmo recurso.' } } }, connect_api: { type: 'object', properties: { source: { const: 'connectapi_local' }, execution: { const: 'rendered_text' }, status: { const: 'APPROVED' }, approved: { const: true } } } }, required: ['data', 'connect_api'] },
  SendTemplateRequest: { type: 'object', properties: { number: { type: 'string', description: 'Telefone internacional do destinatário.' }, ...identity, version, components: { type: 'array', description: 'Parâmetros do envio, não a definição do template. Templates persistidos aceitam parâmetros BODY de texto neste formato.', items: { type: 'object', properties: { type: { type: 'string' }, parameters: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['type', 'parameters'] } } }, required: ['number', 'name', 'language'], additionalProperties: true },
};

export const localTemplatePagination = [
  { name: 'after', in: 'query', schema: { type: 'string', pattern: '^lt_[a-f0-9-]{32,36}$' }, description: 'Cursor retornado na página anterior.' },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 }, description: 'Até 100 templates por página.' },
];
const success = name => ({ description: 'Operação concluída.', content: { 'application/json': { schema: ref(name) } } });
const request = name => ({ required: true, content: { 'application/json': { schema: ref(name) } } });
const errors = { '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' }, '409': { description: 'Conflito de versão, nome reservado ou template indisponível.' } };
export const localTemplateOperations = {
  'GET /localTemplate/find/{instanceName}': { summary: 'Listar templates persistidos da instância', description: 'Leitura paginada sem mutação. O contrato é independente do consumidor. O suporte atual do catálogo persistido abrange ZAPO/Baileys; providers com catálogo nativo usam seus adaptadores específicos.', parameters: localTemplatePagination, responses: { '200': success('LocalTemplateList'), ...errors } },
  'POST /localTemplate/create/{instanceName}': { summary: 'Cadastrar template', description: 'Cria um template persistido por instância. Nome e idioma são únicos dentro da instância.', requestBody: request('LocalTemplateCreate'), responses: { '201': success('LocalTemplate'), ...errors } },
  'POST /localTemplate/edit/{instanceName}': { summary: 'Editar ou habilitar template', description: 'Nome/idioma imutáveis. version obrigatório evita sobrescrever uma edição concorrente. enabled controla disponibilidade.', requestBody: request('LocalTemplateEdit'), responses: { '200': success('LocalTemplate'), ...errors } },
  'DELETE /localTemplate/delete/{instanceName}': { summary: 'Arquivar template', description: 'Arquivamento lógico; bloqueia envios e mantém a identidade reservada.', requestBody: request('LocalTemplateDelete'), responses: { '200': { description: 'Template arquivado.', content: { 'application/json': { schema: { type: 'object', properties: { success: { const: true } }, required: ['success'] } } } }, ...errors } },
  'POST /message/sendTemplate/{instanceName}': { summary: 'Enviar template', description: 'Despacha o template pela estratégia do provider da instância. Business preserva o envio nativo oficial; ZAPO/Baileys renderizam o template persistido e usam o envio nativo da conexão. O consumidor não precisa conhecer essa diferença.', requestBody: request('SendTemplateRequest'), responses: { '201': { description: 'Resposta real do provider; templates persistidos incluem connect_api.template com origem e versão.' }, ...errors } },
};
