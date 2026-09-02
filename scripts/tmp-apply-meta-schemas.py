from pathlib import Path

p = Path('docs/scripts/generate-openapi.mjs')
text = p.read_text()

import_line = "import { metaCompatibleSchemas, metaCompatibilityAdminSchemas } from './meta-compatible-schemas.mjs';\n"
if import_line not in text:
    anchor = "import crypto from 'node:crypto';\n"
    if anchor not in text:
        raise SystemExit('import anchor not found')
    text = text.replace(anchor, anchor + import_line, 1)

native_schema_anchor = "      schemas: {\n        GenericResponse:"
if native_schema_anchor not in text:
    raise SystemExit('native schemas anchor not found')
text = text.replace(
    native_schema_anchor,
    "      schemas: {\n        ...metaCompatibilityAdminSchemas,\n        GenericResponse:",
    1,
)

old_get = "  'GET /compat/meta/{instanceName}': { summary: 'Consultar Meta Compatible', description: 'Retorna configuração e identidade compatível com Meta Cloud da instância.' },"
new_get = """  'GET /compat/meta/{instanceName}': {
    summary: 'Consultar Meta Compatible',
    description: 'Retorna a identidade Graph derivada da instância e a configuração opcional do webhook Meta Compatible.',
    responses: {
      '200': { description: 'Identidade Meta Compatible da instância.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaCompatibilityConfig' } } } },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { $ref: '#/components/responses/NotFound' },
    },
  },"""
if old_get not in text:
    raise SystemExit('GET compat override not found')
text = text.replace(old_get, new_get, 1)

old_put_body = "requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { webhookUrl: { type: ['string', 'null'], format: 'uri' } } }, example: { webhookUrl: 'https://example.com/webhooks/meta' } } } },"
new_put_body = """requestBody: {
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
    },"""
if old_put_body not in text:
    raise SystemExit('PUT compat body not found')
text = text.replace(old_put_body, new_put_body, 1)

graph_start = text.index('function graphSpec(version)')
graph = text[graph_start:]

replacements = [
    (
        "requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, type: { type: 'string' }, messaging_product: { type: 'string', const: 'whatsapp' } }, required: ['file'] } } } },",
        "requestBody: { required: true, content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/MetaMediaUploadRequest' } } } },",
    ),
    (
        "'200': { description: 'Mídia recebida para uso temporário.', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } } }",
        "'200': { description: 'Mídia recebida para uso temporário.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaMediaUploadResponse' } } } }",
    ),
    (
        "'200': { description: 'Lista Meta-shaped. WHATSAPP-BAILEYS retorna `data: []`.', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['data'] } } } }",
        "'200': { description: 'Lista Meta-shaped. WHATSAPP-BAILEYS e CONNECT retornam `data: []`.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaTemplateListResponse' } } } }",
    ),
    (
        "'200': { description: 'Metadados e URL presigned segura.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }",
        "'200': { description: 'Metadados e URL presigned segura.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaMediaResponse' } } } }",
    ),
    (
        "responses: { '200': { description: 'Mensagem enviada.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetaMessageResponse' } } } },",
        "responses: { '200': { description: 'Mensagem enviada ou leitura confirmada.', content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/MetaMessageResponse' }, { $ref: '#/components/schemas/MetaReadReceiptResponse' }] } } } },",
    ),
]

for old, new in replacements:
    if old not in graph:
        raise SystemExit(f'graph replacement not found: {old[:100]}')
    graph = graph.replace(old, new, 1)

schema_start = graph.index('      schemas: {')
responses_start = graph.index('      responses: {', schema_start)
graph = graph[:schema_start] + '      schemas: metaCompatibleSchemas,\n' + graph[responses_start:]
text = text[:graph_start] + graph

p.write_text(text)

# Guide: expose the schema catalog as a first-class integration contract.
guide = Path('docs/guides/meta-compatible.md')
g = guide.read_text()
marker = '## Autenticação Graph\n'
section = """## Schemas de integração

O contrato OpenAPI Meta Compatible publica schemas explícitos para os formatos realmente aceitos pelo adapter: texto, imagem, vídeo, documento, áudio, localização, contatos, reação, interativos `button`/`list`, leitura, mídia, templates, webhooks e erros Graph.

A API nativa também publica `MetaCompatibilityConfig` e `MetaCompatibilityUpdateRequest`, que documentam a ponte entre uma instância Connect|API e sua identidade `/graph`.

"""
if section not in g:
    if marker not in g:
        raise SystemExit('guide marker not found')
    g = g.replace(marker, section + marker, 1)
    guide.write_text(g)
