import { request } from './client.js';

const triggerFields = [
  {
    key: 'triggerType',
    label: 'Gatilho',
    type: 'select',
    required: true,
    defaultValue: 'all',
    options: ['all', 'keyword', 'none', 'advanced'],
  },
  {
    key: 'triggerOperator',
    label: 'Operador',
    type: 'select',
    defaultValue: 'contains',
    options: ['equals', 'contains', 'startsWith', 'endsWith', 'regex'],
  },
  { key: 'triggerValue', label: 'Valor do gatilho' },
  { key: 'expire', label: 'Expiração (segundos)', type: 'number', defaultValue: 0 },
  { key: 'keywordFinish', label: 'Palavra para encerrar' },
  { key: 'delayMessage', label: 'Atraso da mensagem (ms)', type: 'number', defaultValue: 0 },
  { key: 'unknownMessage', label: 'Mensagem desconhecida', type: 'textarea' },
  { key: 'listeningFromMe', label: 'Processar mensagens enviadas por mim', type: 'boolean' },
  { key: 'stopBotFromMe', label: 'Permitir interrupção pelo operador', type: 'boolean' },
  { key: 'keepOpen', label: 'Manter sessão aberta', type: 'boolean' },
  { key: 'debounceTime', label: 'Debounce (ms)', type: 'number', defaultValue: 0 },
  { key: 'ignoreJids', label: 'JIDs ignorados', type: 'list', hint: 'Um JID por linha.' },
];

const messagingFields = [
  { key: 'splitMessages', label: 'Dividir respostas longas', type: 'boolean' },
  { key: 'timePerChar', label: 'Tempo por caractere (ms)', type: 'number', defaultValue: 0 },
];

const baseFields = [
  { key: 'enabled', label: 'Ativo', type: 'boolean', defaultValue: true },
  { key: 'description', label: 'Descrição' },
];

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
};

const messagingSettings = {
  ...commonSettings,
  splitMessages: false,
  timePerChar: 0,
};

export const definitions = {
  typebot: {
    title: 'Typebot',
    fields: [
      ...baseFields,
      { key: 'url', label: 'URL', type: 'url', required: true },
      { key: 'typebot', label: 'Typebot', required: true },
      ...triggerFields,
    ],
    defaultSettings: {
      ...commonSettings,
      typebotIdFallback: '',
    },
  },
  dify: {
    title: 'Dify',
    fields: [
      ...baseFields,
      {
        key: 'botType',
        label: 'Tipo',
        type: 'select',
        required: true,
        defaultValue: 'chatBot',
        options: ['chatBot', 'textGenerator', 'agent', 'workflow'],
      },
      { key: 'apiUrl', label: 'URL da API', type: 'url' },
      { key: 'apiKey', label: 'Chave da API', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: {
      ...messagingSettings,
      difyIdFallback: '',
    },
  },
  n8n: {
    title: 'n8n',
    fields: [
      ...baseFields,
      { key: 'webhookUrl', label: 'URL do Webhook', type: 'url', required: true },
      { key: 'basicAuthUser', label: 'Usuário Basic Auth' },
      { key: 'basicAuthPass', label: 'Senha Basic Auth', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: {
      ...messagingSettings,
      botIdFallback: '',
    },
  },
  connectAI: {
    title: 'ConnectAI',
    fields: [
      ...baseFields,
      { key: 'agentUrl', label: 'URL do agente', type: 'url', required: true },
      { key: 'apiKey', label: 'Chave da API', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: {
      ...messagingSettings,
      connectAIIdFallback: '',
    },
  },
  connectBot: {
    title: 'ConnectBot',
    fields: [
      ...baseFields,
      { key: 'apiUrl', label: 'URL da API', type: 'url', required: true },
      { key: 'apiKey', label: 'Chave da API', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: {
      ...messagingSettings,
      botIdFallback: '',
    },
  },
  flowise: {
    title: 'Flowise',
    fields: [
      ...baseFields,
      { key: 'apiUrl', label: 'URL da API', type: 'url', required: true },
      { key: 'apiKey', label: 'Chave da API', type: 'password' },
      ...triggerFields,
      ...messagingFields,
    ],
    defaultSettings: {
      ...commonSettings,
      flowiseIdFallback: '',
      splitMessages: false,
      timePerChar: 0,
    },
  },
  openai: {
    title: 'OpenAI',
    fields: [
      ...baseFields,
      { key: 'openaiCredsId', label: 'Credencial', required: true },
      {
        key: 'botType',
        label: 'Tipo',
        type: 'select',
        required: true,
        defaultValue: 'assistant',
        options: ['assistant', 'chatCompletion'],
      },
      { key: 'assistantId', label: 'Assistant ID' },
      { key: 'functionUrl', label: 'URL de funções', type: 'url' },
      { key: 'model', label: 'Modelo' },
      { key: 'systemMessages', label: 'Mensagens de sistema', type: 'list' },
      { key: 'assistantMessages', label: 'Mensagens do assistente', type: 'list' },
      { key: 'userMessages', label: 'Mensagens do usuário', type: 'list' },
      { key: 'maxTokens', label: 'Máximo de tokens', type: 'number' },
      ...triggerFields,
    ],
    defaultSettings: {
      ...commonSettings,
      openaiCredsId: '',
      openaiIdFallback: '',
      speechToText: false,
    },
  },
};

function instanceName(instance) {
  return encodeURIComponent(instance.name || instance.instanceName || '');
}

export async function findIntegrations(session, instance, key) {
  const data = await request(session, `/${key}/find/${instanceName(instance)}`, {}, instance.token);
  return Array.isArray(data) ? data : data ? [data] : [];
}

export const fetchIntegration = (session, instance, key, id) =>
  request(
    session,
    `/${key}/fetch/${encodeURIComponent(id)}/${instanceName(instance)}`,
    {},
    instance.token,
  );

export const createIntegration = (session, instance, key, data) =>
  request(session, `/${key}/create/${instanceName(instance)}`, { method: 'POST', data }, instance.token);

export const updateIntegration = (session, instance, key, id, data) =>
  request(
    session,
    `/${key}/update/${encodeURIComponent(id)}/${instanceName(instance)}`,
    { method: 'PUT', data },
    instance.token,
  );

export const deleteIntegration = (session, instance, key, id) =>
  request(
    session,
    `/${key}/delete/${encodeURIComponent(id)}/${instanceName(instance)}`,
    { method: 'DELETE' },
    instance.token,
  );

export async function fetchSettings(session, instance, key) {
  const data = await request(
    session,
    `/${key}/fetchSettings/${instanceName(instance)}`,
    {},
    instance.token,
  );
  if (Array.isArray(data)) return data[0] || definitions[key]?.defaultSettings || {};
  return data || definitions[key]?.defaultSettings || {};
}

export const saveSettings = (session, instance, key, data) =>
  request(
    session,
    `/${key}/settings/${instanceName(instance)}`,
    { method: 'POST', data },
    instance.token,
  );

export const fetchSessions = (session, instance, key, id) =>
  request(
    session,
    `/${key}/fetchSessions/${encodeURIComponent(id)}/${instanceName(instance)}`,
    {},
    instance.token,
  );

export const changeIntegrationStatus = (session, instance, key, remoteJid, status) =>
  request(
    session,
    `/${key}/changeStatus/${instanceName(instance)}`,
    { method: 'POST', data: { remoteJid, status } },
    instance.token,
  );

export const changeIgnoredJid = (session, instance, key, remoteJid, action) =>
  request(
    session,
    `/${key}/ignoreJid/${instanceName(instance)}`,
    { method: 'POST', data: { remoteJid, action } },
    instance.token,
  );

export const findOpenAiCredentials = (session, instance) =>
  request(session, `/openai/creds/${instanceName(instance)}`, {}, instance.token);

export const createOpenAiCredential = (session, instance, data) =>
  request(
    session,
    `/openai/creds/${instanceName(instance)}`,
    { method: 'POST', data },
    instance.token,
  );

export const deleteOpenAiCredential = (session, instance, id) =>
  request(
    session,
    `/openai/creds/${encodeURIComponent(id)}/${instanceName(instance)}`,
    { method: 'DELETE' },
    instance.token,
  );

export const getOpenAiModels = (session, instance, openaiCredsId) =>
  request(
    session,
    `/openai/getModels/${instanceName(instance)}`,
    { params: { openaiCredsId } },
    instance.token,
  );

export const getId = (item) =>
  String(
    item?.id ||
      item?.openaiBotId ||
      item?.typebotId ||
      item?.difyId ||
      item?.n8nId ||
      item?.connectAIId ||
      item?.connectBotId ||
      item?.flowiseId ||
      '',
  );
