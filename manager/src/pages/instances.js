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
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function statistic(value, label) {
  return el('span', {}, el('strong', { text: Number(value || 0).toLocaleString('pt-BR') }), label);
}

function instanceIdOf(instance) {
  return instance.id || instance.instanceId || '';
}

function secretInput(value) {
  const control = input(value, { required: true, autocomplete: 'off', type: 'password' });
  const toggle = button('Mostrar', {
    class: 'secret-toggle',
    onclick: () => {
      const reveal = control.type === 'password';
      control.type = reveal ? 'text' : 'password';
      toggle.textContent = reveal ? 'Ocultar' : 'Mostrar';
    },
  });
  return { control, node: el('div', { class: 'secret-field' }, control, toggle) };
}

export function renderInstances() {
  const session = loadSession();
  const page = el('div', { class: 'page' });
  const grid = el('div', { class: 'instance-grid' });
  const emptyState = el('div', { class: 'instance-empty-state' });
  const feedback = el('div');
  const search = input('', { placeholder: 'Buscar instância' });
  let items = [];

  async function reload() {
    emptyState.replaceChildren();
    grid.replaceChildren(el('div', { class: 'center' }, spinner()));
    feedback.replaceChildren();
    try {
      items = await fetchInstances(session);
      draw();
    } catch (error) {
      grid.replaceChildren();
      emptyState.replaceChildren();
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function drawEmpty(title, description, action = null) {
    grid.hidden = true;
    emptyState.hidden = false;
    emptyState.replaceChildren(
      el('div', { class: 'empty-state-icon', text: '+' }),
      el('strong', { text: title }),
      el('span', { text: description }),
      action,
    );
  }

  function draw() {
    const term = search.value.trim().toLowerCase();
    const visible = items.filter((item) =>
      String(item.name || item.instanceName || '').toLowerCase().includes(term),
    );

    grid.replaceChildren();
    emptyState.replaceChildren();

    if (!items.length) {
      drawEmpty(
        'Nenhuma conexão configurada',
        'Crie sua primeira instância para começar.',
        button('Nova instância', { class: 'primary', onclick: openCreate }),
      );
      return;
    }

    if (!visible.length) {
      drawEmpty('Nenhum resultado', 'Nenhuma instância corresponde à busca atual.');
      return;
    }

    grid.hidden = false;
    emptyState.hidden = true;

    visible.forEach((item) => {
      const id = instanceIdOf(item);
      const name = item.name || item.instanceName || id;
      const identity = item.profilePicUrl
        ? el('img', { class: 'instance-avatar', src: item.profilePicUrl, alt: '' })
        : el('div', { class: 'instance-avatar fallback', text: name[0]?.toUpperCase() || '?' });
      const manage = button('Gerenciar', {
        class: 'primary',
        disabled: !id,
        onclick: () => id && navigate(`/manager/instance/${encodeURIComponent(id)}/dashboard`),
      });
      const remove = button('Excluir', {
        class: 'danger',
        onclick: async () => {
          if (!window.confirm(`Excluir definitivamente ${name}?`)) return;
          remove.disabled = true;
          try {
            await deleteInstance(session, { ...item, name });
            items = items.filter((candidate) => instanceIdOf(candidate) !== id && candidate.name !== name);
            draw();
            feedback.replaceChildren(alertBox('Instância e dados associados removidos.', 'success'));
          } catch (error) {
            feedback.replaceChildren(alertBox(error.message || String(error)));
            remove.disabled = false;
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
              { class: 'instance-identity' },
              identity,
              el(
                'div',
                {},
                el('h3', { text: name }),
                el('span', {
                  class: 'muted',
                  text: item.profileName || item.number || item.integration || 'Sem perfil conectado',
                }),
              ),
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
      { value: 'WHATSAPP-ZAPO', label: 'WhatsApp (Zapo)' },
      { value: 'WHATSAPP-BUSINESS', label: 'WhatsApp Business / Cloud' },
    ]);
    const generated = secretInput(generateToken());
    const token = generated.control;
    const number = input('', {
      type: 'tel',
      placeholder: '5575999999999',
      inputmode: 'numeric',
      autocomplete: 'off',
    });
    const businessId = input('', { autocomplete: 'off' });
    const businessField = field('Business ID', businessId, 'Usado somente pelo WhatsApp Business / Cloud.');

    const syncProviderFields = () => {
      const isBusiness = integration.value === 'WHATSAPP-BUSINESS';
      businessField.hidden = !isBusiness;
      businessId.required = isBusiness;
    };
    integration.addEventListener('change', syncProviderFields);
    syncProviderFields();

    const formFeedback = el('div');
    const form = el(
      'form',
      { class: 'form-stack' },
      formFeedback,
      field('Nome', name),
      field('Canal', integration),
      field('Token da instância', generated.node, 'UUID seguro gerado automaticamente; pode ser personalizado.'),
      field('Número', number, 'Opcional para Baileys/Zapo; DDI + DDD + número.'),
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
          token: token.value.trim(),
        };
        const normalizedNumber = number.value.replace(/\D/g, '');
        if (normalizedNumber) payload.number = normalizedNumber;
        if (integration.value === 'WHATSAPP-BUSINESS') {
          const value = businessId.value.trim();
          if (value) payload.businessId = value;
        }
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
    emptyState,
    grid,
  );

  search.addEventListener('input', draw);
  void reload();
  return managerShell(page);
}
