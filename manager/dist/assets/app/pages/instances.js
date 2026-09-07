import { api } from '../api/manager.js';
import { alertBox, badge, button, card, confirmDialog, el, emptyState, field, input, modal, select, spinner } from '../core/dom.js';
import { navigate } from '../core/router.js';
import { hasPermission } from '../core/session.js';
import { appShell, pageHeader } from '../components/shell.js';

const count = (value) => Number(value || 0).toLocaleString('pt-BR');

export function renderInstances() {
  const page = el('div', { class: 'page' });
  const search = input('', { placeholder: 'Buscar por nome, número ou canal' });
  const grid = el('div', { class: 'instance-grid' });
  const feedback = el('div');
  let items = [];

  async function load() {
    grid.replaceChildren(el('div', { class: 'center' }, spinner()));
    try { items = await api.instances(); draw(); }
    catch (error) { grid.replaceChildren(alertBox(error.message || String(error))); }
  }
  function draw() {
    const term = search.value.trim().toLowerCase();
    const visible = items.filter((item) => [item.name, item.instanceName, item.number, item.integration, item.profileName].some((value) => String(value || '').toLowerCase().includes(term)));
    grid.replaceChildren();
    if (!visible.length) {
      grid.append(emptyState(items.length ? 'Nenhum resultado' : 'Nenhuma instância', items.length ? 'Ajuste os filtros de busca.' : 'Crie a primeira conexão do Connect|API.', hasPermission('instances.manage') && !items.length ? button('Nova instância', { class: 'primary', onclick: openCreate }) : null));
      return;
    }
    visible.forEach((item) => {
      const ref = item.id || item.instanceId || item.name;
      const name = item.name || item.instanceName || 'Instância';
      const avatar = item.profilePicUrl ? el('img', { class: 'instance-avatar', src: item.profilePicUrl, alt: '' }) : el('div', { class: 'instance-avatar fallback', text: (item.profileName || name)[0]?.toUpperCase() || '?' });
      const menu = hasPermission('instances.manage') ? button('⋮', { class: 'icon-btn ghost', onclick: (event) => openActions(event.currentTarget, item) }) : null;
      grid.append(card(
        el('div', { class: 'instance-card-head' }, el('div', { class: 'instance-identity' }, avatar, el('div', {}, el('h3', { text: name }), el('span', { class: 'muted', text: item.profileName || item.number || prettyIntegration(item.integration) }))), badge(item.connectionStatus), menu),
        el('div', { class: 'instance-provider' }, el('span', { text: prettyIntegration(item.integration) }), item.number ? el('span', { text: item.number }) : null),
        el('div', { class: 'stats' }, stat('Contatos', item._count?.Contact), stat('Conversas', item._count?.Chat), stat('Mensagens', item._count?.Message)),
        el('div', { class: 'card-actions' }, button('Abrir', { class: 'primary', onclick: () => navigate(`/manager/instances/${encodeURIComponent(ref)}`) })),
      ));
    });
  }
  function stat(label, value) { return el('div', {}, el('strong', { text: count(value) }), el('span', { text: label })); }
  function prettyIntegration(value) { return ({ 'WHATSAPP-BAILEYS': 'WhatsApp • Baileys', 'WHATSAPP-ZAPO': 'WhatsApp • Zapo', 'WHATSAPP-BUSINESS': 'WhatsApp • Meta Cloud' })[value] || String(value || 'WhatsApp'); }
  function openActions(anchor, item) {
    document.querySelectorAll('.context-menu').forEach((node) => node.remove());
    const ref = item.id || item.instanceId || item.name;
    const menu = el('div', { class: 'context-menu' },
      button('Reiniciar', { class: 'menu-action', onclick: async () => { menu.remove(); await action(() => api.restartInstance(ref), 'Instância reiniciada.'); } }),
      button('Desconectar', { class: 'menu-action', onclick: async () => { menu.remove(); await action(() => api.logoutInstance(ref), 'Instância desconectada.'); } }),
      el('hr'),
      button('Excluir', { class: 'menu-action danger', onclick: async () => { menu.remove(); if (!await confirmDialog('Excluir instância', `Excluir definitivamente ${item.name || item.instanceName}?`, 'Excluir')) return; await action(() => api.deleteInstance(ref), 'Instância excluída.'); } }),
    );
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
    menu.style.left = `${Math.max(12, rect.right - 180 + window.scrollX)}px`;
    document.body.append(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }
  async function action(fn, message) {
    feedback.replaceChildren();
    try { await fn(); feedback.replaceChildren(alertBox(message, 'success')); await load(); }
    catch (error) { feedback.replaceChildren(alertBox(error.message || String(error))); }
  }
  function openCreate() {
    const name = input('', { required: true, placeholder: 'atendimento-comercial' });
    const integration = select('WHATSAPP-BAILEYS', [
      { value: 'WHATSAPP-BAILEYS', label: 'WhatsApp — Baileys' },
      { value: 'WHATSAPP-ZAPO', label: 'WhatsApp — Zapo' },
      { value: 'WHATSAPP-BUSINESS', label: 'WhatsApp — Meta Cloud' },
    ]);
    const number = input('', { type: 'tel', placeholder: '5575999999999' });
    const businessId = input('', { placeholder: 'Business ID' });
    const localFeedback = el('div');
    const form = el('form', { class: 'form-stack' }, localFeedback, field('Nome da instância', name), field('Canal', integration), field('Número', number, 'DDI + DDD + número; opcional para QR Code.'), field('Business ID', businessId, 'Necessário somente para Meta Cloud.'), button('Criar instância', { class: 'primary', type: 'submit' }));
    const dialog = modal('Nova instância', form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const payload = { instanceName: name.value.trim(), integration: integration.value };
        if (number.value.replace(/\D/g, '')) payload.number = number.value.replace(/\D/g, '');
        if (businessId.value.trim()) payload.businessId = businessId.value.trim();
        await api.createInstance(payload);
        dialog.close(); await load();
      } catch (error) { localFeedback.replaceChildren(alertBox(error.message || String(error))); }
    };
  }

  page.append(pageHeader('Instâncias', 'Gerencie as conexões deste ambiente.', [hasPermission('instances.manage') ? button('Nova instância', { class: 'primary', onclick: openCreate }) : null]), el('div', { class: 'toolbar' }, el('div', { class: 'search-box' }, '⌕', search)), feedback, grid);
  search.addEventListener('input', draw);
  void load();
  return appShell(page, { title: 'Instâncias', subtitle: 'Comunicação' });
}
