export type InstanceSettingKey = 'settings' | 'proxy' | 'webhook' | 'websocket' | 'rabbitmq' | 'sqs' | 'chatwoot'

export const settingTitles: Record<InstanceSettingKey, string> = {
  settings: 'Comportamento',
  proxy: 'Proxy',
  webhook: 'Webhooks',
  websocket: 'WebSocket',
  rabbitmq: 'RabbitMQ',
  sqs: 'SQS',
  chatwoot: 'Chatwoot',
}

export const settingDescriptions: Record<InstanceSettingKey, string> = {
  settings: 'Preferências de uso, leitura, chamadas e histórico da instância.',
  proxy: 'Defina uma rota de conexão específica para esta instância.',
  webhook: 'Envie eventos da instância para sistemas externos.',
  websocket: 'Distribua eventos em tempo real por conexão persistente.',
  rabbitmq: 'Publique eventos da instância em filas RabbitMQ.',
  sqs: 'Publique eventos da instância em filas SQS.',
  chatwoot: 'Sincronize atendimentos, contatos e mensagens com o Chatwoot.',
}

export const eventOptions = [
  ['APPLICATION_STARTUP', 'Inicialização da aplicação'],
  ['QRCODE_UPDATED', 'QR Code atualizado'],
  ['MESSAGES_SET', 'Carga inicial de mensagens'],
  ['MESSAGES_UPSERT', 'Nova mensagem'],
  ['MESSAGES_EDITED', 'Mensagem editada'],
  ['MESSAGES_UPDATE', 'Mensagem atualizada'],
  ['MESSAGES_DELETE', 'Mensagem excluída'],
  ['SEND_MESSAGE', 'Mensagem enviada'],
  ['SEND_MESSAGE_UPDATE', 'Atualização de mensagem enviada'],
  ['CONTACTS_SET', 'Carga inicial de contatos'],
  ['CONTACTS_UPSERT', 'Novo contato'],
  ['CONTACTS_UPDATE', 'Contato atualizado'],
  ['PRESENCE_UPDATE', 'Presença atualizada'],
  ['CHATS_SET', 'Carga inicial de conversas'],
  ['CHATS_UPSERT', 'Nova conversa'],
  ['CHATS_UPDATE', 'Conversa atualizada'],
  ['CHATS_DELETE', 'Conversa excluída'],
  ['GROUPS_UPSERT', 'Novo grupo'],
  ['GROUPS_UPDATE', 'Grupo atualizado'],
  ['GROUP_UPDATE', 'Alteração de grupo'],
  ['GROUP_PARTICIPANTS_UPDATE', 'Participantes do grupo alterados'],
  ['CONNECTION_UPDATE', 'Conexão atualizada'],
  ['LABELS_EDIT', 'Marcador editado'],
  ['LABELS_ASSOCIATION', 'Marcador associado'],
  ['CALL', 'Chamada recebida ou atualizada'],
  ['TYPEBOT_START', 'Typebot iniciado'],
  ['TYPEBOT_CHANGE_STATUS', 'Estado do Typebot alterado'],
  ['REMOVE_INSTANCE', 'Instância removida'],
  ['LOGOUT_INSTANCE', 'Instância desconectada'],
  ['INSTANCE_CREATE', 'Instância criada'],
  ['INSTANCE_DELETE', 'Instância excluída'],
  ['STATUS_INSTANCE', 'Estado da instância alterado'],
] as const

export const settingOrder: InstanceSettingKey[] = ['settings', 'proxy', 'webhook', 'websocket', 'rabbitmq', 'sqs', 'chatwoot']
