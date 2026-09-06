import {
  alertBox,
  badge,
  button,
  card,
  el,
  field,
  input,
  modal,
  select,
  spinner,
} from '../core/dom.js';
import { createInstance, deleteInstance, fetchInstances } from '../api/instances.js';
import { navigate } from '../core/router.js';
import { loadSession } from '../core/session.js';
import { managerShell, pageHeader } from '../components/shell.js';

function generateToken() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll('-', '').toUpperCase();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function statistic(value, label) {
  return el(
    'span',
    {},
    el('strong', { text: Number(value || 0).toLocaleString('pt-BR') }),
    label,
  );
}

function instanceIdOf(instance) {
  return instance.id || instance.instanceId || '';
}

export function renderInstances() {
  const session = loadSession();
  const page = el('div', { class: 'page' });
  const grid = el('div', { class: 'instance-grid' });
  const feedback = el('div');
  const search = input('', { placeholder: 'Buscar instância' });
  let items = [];

  async function reload() {
    grid.replaceChildren(el('div', { class: 'center' }, spinner()));
    feedback.replaceChildren();
    try {
      items = await fetchInstances(session);
      draw();
    } catch (error) {
      grid.replaceChildren();
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw() {
    const term = search.value.trim().toLowerCase();
    const visible = items.filter((item) =>
      String(item.name || item.instanceName || '').toLowerCase().includes(term),
    );

    grid.replaceChildren();
    if (!visible.length) {
      grid.append(
        el(
          'div',
          { class: 'empty' },
          el('strong', { text: 'Nenhuma instância encontrada' }),
          el('span', { text: 'Crie uma instância para iniciar.' }),
        ),
      );
      return;
    }

    visible.forEach((item) => {
      const id = instanceIdOf(item);
      const name = item.name || item.instanceName || id;
      const manage = button('Gerenciar', {
        class: 'primary',
        disabled: !id,
        onclick: () => id && navigate(`/manager/instance/${encodeURIComponent(id)}/dashboard`),
      });
      const remove = button('Excluir', {
        class: 'danger',
        onclick: async () => {
          if (!window.confirm(`Excluir definitivamente ${name}?`)) return;
          try {
            await deleteInstance(session, { ...item, name });
            feedback.replaceChildren(alertBox('Instância excluída.', 'success'));
            await reload();
          } catch (error) {
            feedback.replaceChildren(alertBox(error.message || String(error)));
          }
        },
      });

      grid.append(
        card(
          el(
            'div',
            { class: 'instance-card-head' },
            el(
              'div',
              {},
              el('h3', { text: name }),
              el('span', {
                class: 'muted',
                text: item.profileName || item.number || item.integration || 'Sem perfil conectado',
              }),
            ),
            badge(item.connectionStatus),
          ),
          el(
            'div',
            { class: 'stats' },
            statistic(item._count?.Contact, 'contatos'),
            statistic(item._count?.Chat, 'chats'),
            statistic(item._count?.Message, 'mensagens'),
          ),
          el('div', { class: 'card-actions' }, manage, remove),
        ),
      );
    });
  }

  function openCreate() {
    const name = input('', { required: true, autocomplete: 'off' });
    const integration = select('WHATSAPP-BAILEYS', [
      { value: 'WHATSAPP-BAILEYS', label: 'WhatsApp (Baileys)' },
      { value: 'WHATSAPP-BUSINESS', label: 'WhatsApp Business / Cloud' },
      { value: 'WHATSAPP-ZAPO', label: 'WhatsApp (Zapo)' },
    ]);
    const token = input(generateToken(), { required: true, autocomplete: 'off' });
    const number = input('', {
      type: 'tel',
      placeholder: '5575999999999',
      inputmode: 'numeric',
      autocomplete: 'off',
    });
    const businessId = input('', { autocomplete: 'off' });
    const businessField = field('Business ID', businessId, 'Obrigatório para WhatsApp Business / Cloud.');
    businessField.hidden = true;

    integration.addEventListener('change', () => {
      businessField.hidden = integration.value !== 'WHATSAPP-BUSINESS';
      businessId.required = !businessField.hidden;
    });

    const formFeedback = el('div');
    const form = el(
      'form',
      { class: 'form-stack' },
      formFeedback,
      field('Nome', name),
      field('Canal', integration),
      field('Token da instância', token, 'Pode ser personalizado; um valor seguro já foi gerado.'),
      field('Número', number, 'Opcional para Baileys/Zapo; use DDI + DDD + número, somente dígitos.'),
      businessField,
      button('Criar instância', { class: 'primary', type: 'submit' }),
    );

    const dialog = modal('Nova instância', form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      formFeedback.replaceChildren();
      const instanceName = name.value.trim();
      if (!instanceName) return;

      try {
        const payload = {
          instanceName,
          integration: integration.value,
          token: token.value.trim() || null,
          number: number.value.replace(/\D/g, '') || null,
          businessId: businessId.value.trim() || null,
        };
        await createInstance(session, payload);
        dialog.close();
        feedback.replaceChildren(alertBox('Instância criada.', 'success'));
        await reload();
      } catch (error) {
        formFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
  }

  page.append(
    pageHeader('Instâncias', 'Gerencie as conexões disponíveis nesta API.', [
      button('Atualizar', { onclick: reload }),
      button('Nova instância', { class: 'primary', onclick: openCreate }),
    ]),
    el('div', { class: 'toolbar' }, el('div', { class: 'search-box' }, '⌕', search)),
    feedback,
    grid,
  );

  search.addEventListener('input', draw);
  void reload();
  return managerShell(page);
}
