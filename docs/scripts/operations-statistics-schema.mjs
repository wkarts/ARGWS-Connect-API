const optionalNumber = (type = 'number') => ({ type: [type, 'null'], minimum: 0 });
const bucket = {
  type: 'object', additionalProperties: false,
  required: ['label', 'samples', 'requests', 'errors', 'averageMs', 'errorRate', 'gapBatches'],
  properties: {
    label: { type: 'string' }, samples: { type: 'integer', minimum: 0 },
    requests: optionalNumber('integer'), errors: optionalNumber('integer'),
    averageMs: optionalNumber(), errorRate: optionalNumber(), gapBatches: { type: 'integer', minimum: 0 },
  },
};
export const operationsStatisticsOperation = {
  summary: 'Consultar estatísticas operacionais por período',
  description: 'Exige API key global. Datas inclusivas no fuso da instalação; máximo 31 dias. Agrega o período inteiro, não a primeira página do histórico. Campos null indicam ausência de amostras, não zero. Sem dados de comunicação.',
  parameters: ['from', 'to'].map(name => ({ name, in: 'query', required: true, schema: { type: 'string', format: 'date' } })),
  security: [{ apiKey: [] }],
  responses: {
    '200': {
      description: 'Estatísticas de melhor esforço. Cache por dia e limites de leitura; não representa SLA.',
      content: { 'application/json': { schema: {
        type: 'object', additionalProperties: false,
        required: ['from', 'to', 'timezone', 'granularity', 'generatedAt', 'totals', 'series', 'incomplete', 'archives'],
        properties: {
          from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' },
          timezone: { type: 'string' }, granularity: { type: 'string', enum: ['hour', 'day'] },
          generatedAt: { type: 'string', format: 'date-time' }, totals: bucket,
          series: { type: 'array', maxItems: 31, items: bucket }, incomplete: { type: 'boolean' },
          archives: { type: 'array', maxItems: 31, items: {
            type: 'object', additionalProperties: false, required: ['day', 'bytes', 'archived'],
            properties: { day: { type: 'string', format: 'date' }, bytes: { type: 'integer', minimum: 0 }, archived: { type: 'boolean' } },
          } },
        },
      } } },
    },
    '400': { description: 'Período inválido, leitura excedida ou arquivo inconsistente. Nenhum total parcial é retornado.' },
    '403': { description: 'Acesso administrativo necessário; chave de instância não é aceita.' },
    '429': { description: 'Outra consulta ou exportação está em andamento.' },
    '503': { description: 'Monitoramento desabilitado, não configurado ou indisponível.' },
  },
};
