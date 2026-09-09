import type { IntegrationKey, InstanceConfigKey } from '@/types/domain'

export type FieldKind = 'text' | 'url' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'list'
export type FieldDefinition = {
  key: string
  label: string
  kind?: FieldKind
  required?: boolean
  placeholder?: string
  hint?: string
  options?: Array<{ value: string; label: string }>
  defaultValue?: any
}

const common: FieldDefinition[] = [
  { key: 'description', label: 'Nome da configuração', placeholder: 'Ex.: Atendimento principal' },
  { key: 'enabled', label: 'Ativo', kind: 'boolean', defaultValue: false },
  { key: 'triggerType', label: 'Quando iniciar', kind: 'select', required: true, defaultValue: 'all', options: [
    { value: 'all', label: 'Todas as mensagens' },
    { value: 'keyword', label: 'Palavra-chave' },
    { value: 'none', label: 'Somente início manual' },
    { value: 'advanced', label: 'Regra avançada' },
  ] },
  { key: 'triggerOperator', label: 'Regra de comparação', kind: 'select', defaultValue: 'contains', options: [
    { value: 'equals', label: 'Igual a' },
    { value: 'contains', label: 'Contém' },
    { value: 'startsWith', label: 'Começa com' },
    { value: 'endsWith', label: 'Termina com' },
    { value: 'regex', label: 'Expressão regular' },
  ] },
  { key: 'triggerValue', label: 'Valor da regra' },
  { key: 'expire', label: 'Encerrar após (segundos)', kind: 'number', defaultValue: 0 },
  { key: 'keywordFinish', label: 'Palavra para encerrar', defaultValue: '#sair' },
  { key: 'delayMessage', label: 'Atraso de resposta (ms)', kind: 'number', defaultValue: 0 },
  { key: 'unknownMessage', label: 'Resposta quando não entender', kind: 'textarea' },
  { key: 'listeningFromMe', label: 'Considerar mensagens enviadas por mim', kind: 'boolean', defaultValue: false },
  { key: 'stopBotFromMe', label: 'Permitir pausa pelo atendente', kind: 'boolean', defaultValue: false },
  { key: 'keepOpen', label: 'Manter conversa ativa', kind: 'boolean', defaultValue: false },
  { key: 'debounceTime', label: 'Aguardar antes de processar (ms)', kind: 'number', defaultValue: 0 },
  { key: 'ignoreJids', label: 'Contatos ignorados', kind: 'list', hint: 'Um identificador por linha.' },
]

const messaging: FieldDefinition[] = [
  { key: 'splitMessages', label: 'Dividir respostas longas', kind: 'boolean', defaultValue: false },
  { key: 'timePerChar', label: 'Tempo por caractere (ms)', kind: 'number', defaultValue: 0 },
]

export const integrationDefinitions: Record<IntegrationKey, {
  key: IntegrationKey
  label: string
  description: string
  category: 'automation' | 'ai'
  fields: FieldDefinition[]
  credentialMode?: 'openai'
}> = {
  n8n: {
    key: 'n8n',
    label: 'n8n',
    description: 'Encaminhe mensagens para um fluxo n8n e use a resposta no atendimento.',
    category: 'automation',
    fields: [
      { key: 'webhookUrl', label: 'URL do Webhook', kind: 'url', required: true, placeholder: 'https://...' },
      { key: 'basicAuthUser', label: 'Usuário do acesso básico' },
      { key: 'basicAuthPass', label: 'Senha do acesso básico', kind: 'password' },
      ...common,
      ...messaging,
    ],
  },
  typebot: {
    key: 'typebot',
    label: 'Typebot',
    description: 'Conecte um fluxo Typebot à instância.',
    category: 'automation',
    fields: [
      { key: 'url', label: 'Endereço do Typebot', kind: 'url', required: true },
      { key: 'typebot', label: 'Identificador do Typebot', required: true },
      ...common,
    ],
  },
  dify: {
    key: 'dify',
    label: 'Dify',
    description: 'Use aplicações e agentes Dify nas conversas.',
    category: 'ai',
    fields: [
      { key: 'botType', label: 'Tipo', kind: 'select', required: true, defaultValue: 'chatBot', options: [
        { value: 'chatBot', label: 'Chat' },
        { value: 'textGenerator', label: 'Geração de texto' },
        { value: 'agent', label: 'Agente' },
        { value: 'workflow', label: 'Fluxo' },
      ] },
      { key: 'apiUrl', label: 'Endereço da aplicação', kind: 'url' },
      { key: 'apiKey', label: 'Chave de acesso', kind: 'password' },
      ...common,
      ...messaging,
    ],
  },
  flowise: {
    key: 'flowise',
    label: 'Flowise',
    description: 'Conecte fluxos Flowise ao atendimento.',
    category: 'ai',
    fields: [
      { key: 'apiUrl', label: 'Endereço do fluxo', kind: 'url', required: true },
      { key: 'apiKey', label: 'Chave de acesso', kind: 'password' },
      ...common,
      ...messaging,
    ],
  },
  openai: {
    key: 'openai',
    label: 'OpenAI',
    description: 'Configure assistentes ou respostas por modelo para esta instância.',
    category: 'ai',
    credentialMode: 'openai',
    fields: [
      { key: 'openaiCredsId', label: 'Credencial', required: true },
      { key: 'botType', label: 'Modo', kind: 'select', required: true, defaultValue: 'assistant', options: [
        { value: 'assistant', label: 'Assistente' },
        { value: 'chatCompletion', label: 'Conversa por modelo' },
      ] },
      { key: 'assistantId', label: 'Identificador do assistente' },
      { key: 'functionUrl', label: 'Endereço de funções', kind: 'url' },
      { key: 'model', label: 'Modelo' },
      { key: 'systemMessages', label: 'Mensagens de sistema', kind: 'list' },
      { key: 'assistantMessages', label: 'Mensagens do assistente', kind: 'list' },
      { key: 'userMessages', label: 'Mensagens do usuário', kind: 'list' },
      { key: 'maxTokens', label: 'Limite de tokens', kind: 'number' },
      ...common,
    ],
  },
  connectAI: {
    key: 'connectAI',
    label: 'ConnectAI',
    description: 'Use um agente ConnectAI nas conversas desta instância.',
    category: 'ai',
    fields: [
      { key: 'agentUrl', label: 'Endereço do agente', kind: 'url', required: true },
      { key: 'apiKey', label: 'Chave de acesso', kind: 'password' },
      ...common,
      ...messaging,
    ],
  },
  connectBot: {
    key: 'connectBot',
    label: 'ConnectBot',
    description: 'Integre um serviço ConnectBot ao atendimento.',
    category: 'automation',
    fields: [
      { key: 'apiUrl', label: 'Endereço do serviço', kind: 'url', required: true },
      { key: 'apiKey', label: 'Chave de acesso', kind: 'password' },
      ...common,
      ...messaging,
    ],
  },
}

const settingsCommon: FieldDefinition[] = [
  { key: 'expire', label: 'Encerrar após (segundos)', kind: 'number', defaultValue: 0 },
  { key: 'keywordFinish', label: 'Palavra para encerrar', defaultValue: '#sair' },
  { key: 'delayMessage', label: 'Atraso de resposta (ms)', kind: 'number', defaultValue: 0 },
  { key: 'unknownMessage', label: 'Resposta quando não entender', kind: 'textarea', defaultValue: '' },
  { key: 'listeningFromMe', label: 'Considerar mensagens enviadas por mim', kind: 'boolean', defaultValue: false },
  { key: 'stopBotFromMe', label: 'Permitir pausa pelo atendente', kind: 'boolean', defaultValue: false },
  { key: 'keepOpen', label: 'Manter conversa ativa', kind: 'boolean', defaultValue: false },
  { key: 'debounceTime', label: 'Aguardar antes de processar (ms)', kind: 'number', defaultValue: 0 },
  { key: 'ignoreJids', label: 'Contatos ignorados', kind: 'list', defaultValue: [], hint: 'Um identificador por linha.' },
]

const settingsMessaging: FieldDefinition[] = [
  { key: 'splitMessages', label: 'Dividir respostas longas', kind: 'boolean', defaultValue: false },
  { key: 'timePerChar', label: 'Tempo por caractere (ms)', kind: 'number', defaultValue: 0 },
]

// The backend intentionally exposes one generic `fallbackId` in settings
// regardless of the provider-specific database column. Keep the frontend on
// that public contract so n8n/Typebot/Dify/Flowise/ConnectAI/ConnectBot/OpenAI
// preferences remain portable across backend revisions.
export const integrationSettingsDefinitions: Record<IntegrationKey, FieldDefinition[]> = {
  n8n: [...settingsCommon, { key: 'fallbackId', label: 'Configuração de fallback' }, ...settingsMessaging],
  typebot: [...settingsCommon, { key: 'fallbackId', label: 'Typebot de fallback' }],
  dify: [...settingsCommon, { key: 'fallbackId', label: 'Configuração Dify de fallback' }, ...settingsMessaging],
  flowise: [...settingsCommon, { key: 'fallbackId', label: 'Fluxo de fallback' }, ...settingsMessaging],
  connectAI: [...settingsCommon, { key: 'fallbackId', label: 'Agente de fallback' }, ...settingsMessaging],
  connectBot: [...settingsCommon, { key: 'fallbackId', label: 'Configuração de fallback' }, ...settingsMessaging],
  openai: [
    { key: 'openaiCredsId', label: 'Credencial', required: true },
    ...settingsCommon,
    { key: 'speechToText', label: 'Converter áudio recebido em texto', kind: 'boolean', defaultValue: false },
    { key: 'fallbackId', label: 'Configuração OpenAI de fallback' },
  ],
}

export const instanceConfigDefinitions: Record<InstanceConfigKey, { label: string; description: string }> = {
  settings: { label: 'Comportamento', description: 'Preferências de leitura, presença, chamadas e sincronização.' },
  proxy: { label: 'Proxy', description: 'Roteamento de rede específico para esta instância.' },
  webhook: { label: 'Webhooks', description: 'Envio de eventos para sistemas externos.' },
  websocket: { label: 'WebSocket', description: 'Distribuição de eventos em tempo real.' },
  rabbitmq: { label: 'RabbitMQ', description: 'Publicação de eventos em filas RabbitMQ.' },
  nats: { label: 'NATS', description: 'Distribuição de eventos por NATS.' },
  sqs: { label: 'SQS', description: 'Publicação de eventos em filas SQS.' },
  kafka: { label: 'Kafka', description: 'Publicação de eventos em tópicos Kafka.' },
  pusher: { label: 'Pusher', description: 'Distribuição de eventos por canais Pusher.' },
  chatwoot: { label: 'Chatwoot', description: 'Sincronização de conversas com uma caixa de atendimento.' },
}

export const eventOptions = [
  ['APPLICATION_STARTUP', 'Inicialização'],
  ['QRCODE_UPDATED', 'QR Code atualizado'],
  ['MESSAGES_SET', 'Mensagens carregadas'],
  ['MESSAGES_UPSERT', 'Nova mensagem'],
  ['MESSAGES_EDITED', 'Mensagem editada'],
  ['MESSAGES_UPDATE', 'Mensagem atualizada'],
  ['MESSAGES_DELETE', 'Mensagem excluída'],
  ['SEND_MESSAGE', 'Mensagem enviada'],
  ['SEND_MESSAGE_UPDATE', 'Envio atualizado'],
  ['CONTACTS_SET', 'Contatos carregados'],
  ['CONTACTS_UPSERT', 'Novo contato'],
  ['CONTACTS_UPDATE', 'Contato atualizado'],
  ['PRESENCE_UPDATE', 'Presença atualizada'],
  ['CHATS_SET', 'Conversas carregadas'],
  ['CHATS_UPSERT', 'Nova conversa'],
  ['CHATS_UPDATE', 'Conversa atualizada'],
  ['CHATS_DELETE', 'Conversa excluída'],
  ['GROUPS_UPSERT', 'Novo grupo'],
  ['GROUPS_UPDATE', 'Grupo atualizado'],
  ['GROUP_UPDATE', 'Dados do grupo alterados'],
  ['GROUP_PARTICIPANTS_UPDATE', 'Participantes do grupo alterados'],
  ['CONNECTION_UPDATE', 'Conexão atualizada'],
  ['LABELS_EDIT', 'Marcador alterado'],
  ['LABELS_ASSOCIATION', 'Marcador associado'],
  ['CALL', 'Chamada'],
  ['TYPEBOT_START', 'Typebot iniciado'],
  ['TYPEBOT_CHANGE_STATUS', 'Typebot alterado'],
  ['REMOVE_INSTANCE', 'Instância removida'],
  ['LOGOUT_INSTANCE', 'Instância desconectada'],
  ['INSTANCE_CREATE', 'Instância criada'],
  ['INSTANCE_DELETE', 'Instância excluída'],
  ['STATUS_INSTANCE', 'Situação da instância'],
] as const
