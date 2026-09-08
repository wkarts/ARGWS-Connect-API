export type IntegrationKey = 'n8n' | 'typebot' | 'dify' | 'flowise' | 'openai' | 'connectAI' | 'connectBot'

export type IntegrationFieldType = 'text' | 'url' | 'password' | 'number' | 'boolean' | 'textarea' | 'list' | 'select'

export type IntegrationField = {
  key: string
  label: string
  type?: IntegrationFieldType
  required?: boolean
  defaultValue?: unknown
  options?: Array<string | { value: string; label: string }>
  hint?: string
  rows?: number
}

export type IntegrationDefinition = {
  key: IntegrationKey
  title: string
  description: string
  accent: string
  fields: IntegrationField[]
  defaultSettings: Record<string, unknown>
}

const baseFields: IntegrationField[] = [
  { key: 'enabled', label: 'Ativo', type: 'boolean', defaultValue: true },
  { key: 'description', label: 'Descrição' },
]

const triggerFields: IntegrationField[] = [
  {
    key: 'triggerType',
    label: 'Quando executar',
    type: 'select',
    required: true,
    defaultValue: 'all',
    options: [
      { value: 'all', label: 'Todas as mensagens' },
      { value: 'keyword', label: 'Quando encontrar uma palavra ou frase' },
      { value: 'none', label: 'Somente quando iniciado manualmente' },
      { value: 'advanced', label: 'Regra avançada' },
    ],
  },
  {
    key: 'triggerOperator',
    label: 'Comparação',
    type: 'select',
    defaultValue: 'contains',
    options: [
      { value: 'equals', label: 'Igual a' },
      { value: 'contains', label: 'Contém' },
      { value: 'startsWith', label: 'Começa com' },
      { value: 'endsWith', label: 'Termina com' },
      { value: 'regex', label: 'Expressão avançada' },
    ],
  },
  { key: 'triggerValue', label: 'Palavra ou frase' },
  { key: 'expire', label: 'Encerrar após', type: 'number', defaultValue: 0, hint: 'Tempo em segundos. Use 0 para não expirar.' },
  { key: 'keywordFinish', label: 'Palavra para encerrar' },
  { key: 'delayMessage', label: 'Atraso antes de responder', type: 'number', defaultValue: 0, hint: 'Tempo em milissegundos.' },
  { key: 'unknownMessage', label: 'Mensagem quando não houver resposta', type: 'textarea' },
  { key: 'listeningFromMe', label: 'Processar mensagens enviadas pelo atendente', type: 'boolean' },
  { key: 'stopBotFromMe', label: 'Permitir que o atendente interrompa a automação', type: 'boolean' },
  { key: 'keepOpen', label: 'Manter atendimento aberto', type: 'boolean' },
  { key: 'debounceTime', label: 'Aguardar mensagens em sequência', type: 'number', defaultValue: 0, hint: 'Tempo em milissegundos.' },
  { key: 'ignoreJids', label: 'Contatos ignorados', type: 'list', hint: 'Um contato por linha.' },
]

const messagingFields: IntegrationField[] = [
  { key: 'splitMessages', label: 'Dividir respostas longas', type: 'boolean' },
  { key: 'timePerChar', label: 'Ritmo de envio por caractere', type: 'number', defaultValue: 0, hint: 'Tempo em milissegundos.' },
]

const commonSettings = {
  expire: 0,
  keywordFinish: '#sair',
  delayMessage: 0,
  unknownMessage: '',
  listeningFromMe: false,
  stopBotFromMe: false,
  keepOpen: false,
  debounceTime: 0,
  ignoreJids: [],
}

const messagingSettings = {
  ...commonSettings,
  splitMessages: false,
  timePerChar: 0,
}

export const integrationDefinitions: Record<IntegrationKey, IntegrationDefinition> = {
  n8n: {
    key: 'n8n',
    title: 'n8n',
    description: 'Conecte fluxos e automações externas à conversa.',
    accent: 'violet',
    fields: [
      ...baseFields,
      { key: 'webhookUrl', label: 'Endereço do fluxo', type: 'url', required: true },
      { key: 'basicAuthUser', label: 'Usuário de acesso' },
      { key: 'basicAuthPass', label: 'Senha de acesso', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: { ...messagingSettings, botIdFallback: '' },
  },
  typebot: {
    key: 'typebot',
    title: 'Typebot',
    description: 'Use experiências conversacionais construídas no Typebot.',
    accent: 'blue',
    fields: [
      ...baseFields,
      { key: 'url', label: 'Endereço do Typebot', type: 'url', required: true },
      { key: 'typebot', label: 'Identificador do Typebot', required: true },
      ...triggerFields,
    ],
    defaultSettings: { ...commonSettings, typebotIdFallback: '' },
  },
  dify: {
    key: 'dify',
    title: 'Dify',
    description: 'Integre agentes, fluxos e geração de respostas do Dify.',
    accent: 'cyan',
    fields: [
      ...baseFields,
      {
        key: 'botType',
        label: 'Tipo de experiência',
        type: 'select',
        required: true,
        defaultValue: 'chatBot',
        options: [
          { value: 'chatBot', label: 'Chat' },
          { value: 'textGenerator', label: 'Geração de texto' },
          { value: 'agent', label: 'Agente' },
          { value: 'workflow', label: 'Fluxo' },
        ],
      },
      { key: 'apiUrl', label: 'Endereço do Dify', type: 'url' },
      { key: 'apiKey', label: 'Chave de acesso', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: { ...messagingSettings, difyIdFallback: '' },
  },
  flowise: {
    key: 'flowise',
    title: 'Flowise',
    description: 'Conecte fluxos de inteligência e automação do Flowise.',
    accent: 'green',
    fields: [
      ...baseFields,
      { key: 'apiUrl', label: 'Endereço do Flowise', type: 'url', required: true },
      { key: 'apiKey', label: 'Chave de acesso', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: { ...messagingSettings, flowiseIdFallback: '' },
  },
  openai: {
    key: 'openai',
    title: 'OpenAI',
    description: 'Use assistentes e modelos para responder e automatizar conversas.',
    accent: 'slate',
    fields: [
      ...baseFields,
      { key: 'openaiCredsId', label: 'Credencial', type: 'select', required: true },
      {
        key: 'botType',
        label: 'Tipo',
        type: 'select',
        required: true,
        defaultValue: 'assistant',
        options: [
          { value: 'assistant', label: 'Assistente' },
          { value: 'chatCompletion', label: 'Conversa por modelo' },
        ],
      },
      { key: 'assistantId', label: 'Identificador do assistente' },
      { key: 'functionUrl', label: 'Endereço de funções', type: 'url' },
      { key: 'model', label: 'Modelo' },
      { key: 'systemMessages', label: 'Instruções de sistema', type: 'list' },
      { key: 'assistantMessages', label: 'Mensagens do assistente', type: 'list' },
      { key: 'userMessages', label: 'Mensagens do usuário', type: 'list' },
      { key: 'maxTokens', label: 'Limite de resposta', type: 'number' },
      ...triggerFields,
    ],
    defaultSettings: { ...commonSettings, openaiCredsId: '', openaiIdFallback: '', speechToText: false },
  },
  connectAI: {
    key: 'connectAI',
    title: 'ConnectAI',
    description: 'Vincule um agente ConnectAI à instância.',
    accent: 'indigo',
    fields: [
      ...baseFields,
      { key: 'agentUrl', label: 'Endereço do agente', type: 'url', required: true },
      { key: 'apiKey', label: 'Chave de acesso', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: { ...messagingSettings, connectAIIdFallback: '' },
  },
  connectBot: {
    key: 'connectBot',
    title: 'ConnectBot',
    description: 'Conecte um bot compatível aos atendimentos da instância.',
    accent: 'orange',
    fields: [
      ...baseFields,
      { key: 'apiUrl', label: 'Endereço do bot', type: 'url', required: true },
      { key: 'apiKey', label: 'Chave de acesso', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: { ...messagingSettings, botIdFallback: '' },
  },
}

export const integrationOrder: IntegrationKey[] = ['n8n', 'typebot', 'dify', 'flowise', 'openai', 'connectAI', 'connectBot']

export function integrationId(item: any) {
  return String(
    item?.id ||
    item?.openaiBotId ||
    item?.typebotId ||
    item?.difyId ||
    item?.n8nId ||
    item?.connectAIId ||
    item?.connectBotId ||
    item?.flowiseId ||
    '',
  )
}
