import {
  alertBox,
  button,
  card,
  el,
  field,
  input,
  jsonEditor,
  spinner,
  textarea,
  toggle,
} from '../core/dom.js';
import {
  configTitles,
  loadConfiguration,
  saveConfiguration,
} from '../api/configuration.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

const EVENT_NAMES = [
  'APPLICATION_STARTUP',
  'QRCODE_UPDATED',
  'MESSAGES_SET',
  'MESSAGES_UPSERT',
  'MESSAGES_EDITED',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
  'SEND_MESSAGE_UPDATE',
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'PRESENCE_UPDATE',
  'CHATS_SET',
  'CHATS_UPSERT',
  'CHATS_UPDATE',
  'CHATS_DELETE',
  'GROUPS_UPSERT',
  'GROUPS_UPDATE',
  'GROUP_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
  'CONNECTION_UPDATE',
  'LABELS_EDIT',
  'LABELS_ASSOCIATION',
  'CALL',
  'TYPEBOT_START',
  'TYPEBOT_CHANGE_STATUS',
  'REMOVE_INSTANCE',
  'LOGOUT_INSTANCE',
  'INSTANCE_CREATE',
  'INSTANCE_DELETE',
  'STATUS_INSTANCE',
];

function clone(value) {
  return value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : {};
}

function normalize(kind, data) {
  if (!data) return {};
  if (['settings', 'proxy', 'chatwoot'].includes(kind)) return data;
  return data?.[kind] || data || {};
}

function numberOrEmpty(value) {
  if (value === '' || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function eventSelector(current, onChange) {
  const selected = new Set(Array.isArray(current) ? current : []);
  const grid = el('div', { class: 'event-grid' });

  const sync = () => onChange([...selected]);
  EVENT_NAMES.forEach((eventName) => {
    const checkbox = el('input', {
      type: 'checkbox',
      checked: selected.has(eventName),
    });
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(eventName);
      else selected.delete(eventName);
      sync();
    });
    grid.append(el('label', { class: 'event-option' }, checkbox, el('span', { text: eventName })));
  });

  return el(
    'div',
    { class: 'form-stack' },
    el(
      'div',
      { class: 'actions' },
      button('Selecionar todos', {
        onclick: () => {
          EVENT_NAMES.forEach((name) => selected.add(name));
          grid.querySelectorAll('input').forEach((node) => {
            node.checked = true;
          });
          sync();
        },
      }),
      button('Limpar', {
        onclick: () => {
          selected.clear();
          grid.querySelectorAll('input').forEach((node) => {
            node.checked = false;
          });
          sync();
        },
      }),
    ),
    grid,
  );
}

export function renderConfig(instance, kind) {
  const session = loadSession();
  const page = el('div', { class: 'page' });
  const body = el('div');
  const feedback = el('div');
  let value = {};

  function set(key, next) {
    value = { ...value, [key]: next };
  }

  function bindText(key, initial = value[key] ?? '', attrs = {}) {
    const control = input(initial, attrs);
    control.addEventListener('input', () => set(key, control.value));
    return control;
  }

  function bindNumber(key, initial = value[key] ?? '') {
    const control = input(initial, { type: 'number' });
    control.addEventListener('input', () => set(key, numberOrEmpty(control.value)));
    return control;
  }

  async function load() {
    body.replaceChildren(el('div', { class: 'center' }, spinner()));
    feedback.replaceChildren();
    try {
      value = clone(normalize(kind, await loadConfiguration(session, instance, kind)));
      draw();
    } catch (error) {
      body.replaceChildren();
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  async function save() {
    feedback.replaceChildren();
    try {
      await saveConfiguration(session, instance, kind, value);
      feedback.replaceChildren(alertBox('Configuração salva.', 'success'));
      await load();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw() {
    const form = el('div', { class: 'form-stack' });

    if (kind === 'settings') {
      value = {
        rejectCall: false,
        groupsIgnore: false,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
        ...value,
      };
      form.append(
        toggle('Rejeitar chamadas', Boolean(value.rejectCall), (next) => set('rejectCall', next)),
        field('Mensagem ao rejeitar', bindText('msgCall')),
        toggle('Ignorar grupos', Boolean(value.groupsIgnore), (next) => set('groupsIgnore', next)),
        toggle('Sempre online', Boolean(value.alwaysOnline), (next) => set('alwaysOnline', next)),
        toggle('Marcar mensagens como lidas', Boolean(value.readMessages), (next) => set('readMessages', next)),
        toggle('Ler status', Boolean(value.readStatus), (next) => set('readStatus', next)),
        toggle('Sincronizar histórico completo', Boolean(value.syncFullHistory), (next) => set('syncFullHistory', next)),
      );
    } else if (kind === 'proxy') {
      value = { enabled: false, host: '', port: '', protocol: 'http', ...value };
      form.append(
        toggle('Usar proxy', Boolean(value.enabled), (next) => set('enabled', next)),
        field('Servidor', bindText('host')),
        field('Porta', bindText('port')),
        field('Protocolo', bindText('protocol')),
        field('Usuário', bindText('username')),
        field('Senha', bindText('password', value.password || '', { type: 'password', autocomplete: 'new-password' })),
      );
    } else if (kind === 'webhook') {
      value = { enabled: false, url: '', headers: {}, byEvents: false, base64: false, events: [], ...value };
      const headersArea = textarea(JSON.stringify(value.headers || {}, null, 2), { rows: 6 });
      const headersFeedback = el('small', { class: 'error-text' });
      headersArea.addEventListener('input', () => {
        try {
          const parsed = JSON.parse(headersArea.value || '{}');
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
          headersFeedback.textContent = '';
          set('headers', parsed);
        } catch {
          headersFeedback.textContent = 'JSON de headers inválido';
        }
      });
      form.append(
        toggle('Webhook ativo', Boolean(value.enabled), (next) => set('enabled', next)),
        field('URL', bindText('url', value.url || '', { type: 'url' })),
        toggle('Separar por eventos', Boolean(value.byEvents), (next) => set('byEvents', next)),
        toggle('Enviar mídia em Base64', Boolean(value.base64), (next) => set('base64', next)),
        field('Headers HTTP', el('div', {}, headersArea, headersFeedback)),
        field('Eventos', eventSelector(value.events, (events) => set('events', events))),
      );
    } else if (['websocket', 'rabbitmq', 'sqs'].includes(kind)) {
      value = { enabled: false, events: [], ...value };
      form.append(
        toggle('Integração ativa', Boolean(value.enabled), (next) => set('enabled', next)),
        field('Eventos', eventSelector(value.events, (events) => set('events', events))),
      );
    } else if (kind === 'chatwoot') {
      value = {
        enabled: false,
        signMsg: false,
        reopenConversation: false,
        conversationPending: false,
        autoCreate: false,
        importContacts: false,
        mergeBrazilContacts: false,
        importMessages: false,
        ignoreJids: [],
        ...value,
      };
      const ignored = textarea(Array.isArray(value.ignoreJids) ? value.ignoreJids.join('\n') : '', { rows: 4 });
      ignored.addEventListener('input', () => {
        set(
          'ignoreJids',
          ignored.value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean),
        );
      });
      form.append(
        toggle('Chatwoot ativo', Boolean(value.enabled), (next) => set('enabled', next)),
        field('URL', bindText('url', value.url || '', { type: 'url' })),
        field('Account ID', bindText('accountId')),
        field('Token', bindText('token', value.token || '', { type: 'password', autocomplete: 'new-password' })),
        field('Nome da caixa', bindText('nameInbox')),
        field('Delimitador da assinatura', bindText('signDelimiter')),
        toggle('Assinar mensagens', Boolean(value.signMsg), (next) => set('signMsg', next)),
        toggle('Reabrir conversa', Boolean(value.reopenConversation), (next) => set('reopenConversation', next)),
        toggle('Criar conversa como pendente', Boolean(value.conversationPending), (next) => set('conversationPending', next)),
        toggle('Criar automaticamente', Boolean(value.autoCreate), (next) => set('autoCreate', next)),
        toggle('Importar contatos', Boolean(value.importContacts), (next) => set('importContacts', next)),
        toggle('Mesclar contatos do Brasil', Boolean(value.mergeBrazilContacts), (next) => set('mergeBrazilContacts', next)),
        toggle('Importar mensagens', Boolean(value.importMessages), (next) => set('importMessages', next)),
        field('Limite de dias para importar mensagens', bindNumber('daysLimitImportMessages')),
        field('JIDs ignorados', ignored, 'Um JID por linha.'),
      );
    }

    form.append(
      el(
        'details',
        {},
        el('summary', { text: 'Configuração avançada' }),
        jsonEditor(value, (next) => {
          value = next;
        }),
      ),
    );

    body.replaceChildren(card(form));
  }

  page.append(
    pageHeader(
      configTitles[kind] || kind,
      `Configuração da instância ${instance.name || instance.instanceName}.`,
      [button('Salvar', { class: 'primary', onclick: save })],
    ),
    feedback,
    body,
  );

  void load();
  return instanceShell(instance, kind, page);
}
