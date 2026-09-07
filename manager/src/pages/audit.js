import { api } from '../api/manager.js';
import { alertBox, el, emptyState, spinner } from '../core/dom.js';
import { appShell, pageHeader } from '../components/shell.js';
export function renderAudit() {
  const page = el('div', { class: 'page' }, pageHeader('Auditoria', 'Histórico local de ações administrativas relevantes.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  void api.audit(500).then((items) => {
    if (!items.length) { body.replaceChildren(emptyState('Sem eventos', 'Nenhuma ação administrativa foi registrada ainda.')); return; }
    const table = el('div', { class: 'table-card' }, el('table', { class: 'data-table' }, el('thead', {}, el('tr', {}, ...['Data', 'Usuário', 'Ação', 'Recurso'].map((label) => el('th', { text: label })))), el('tbody')));
    const tbody = table.querySelector('tbody'); items.forEach((item) => tbody.append(el('tr', {}, el('td', { text: new Date(item.timestamp).toLocaleString('pt-BR') }), el('td', { text: item.actorEmail || 'system' }), el('td', { text: item.action }), el('td', { text: item.resource })))); body.replaceChildren(table);
  }).catch((error) => body.replaceChildren(alertBox(error.message || String(error))));
  return appShell(page, { title: 'Auditoria', subtitle: 'Administração' });
}
