import { api } from '../api/manager.js';
import { alertBox, badge, card, el, spinner } from '../core/dom.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';
export function renderUpdates() {
  const page = el('div', { class: 'page' }, pageHeader('Atualizações', 'Canal de versões e disponibilidade de releases autorizadas.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  void api.updates().then((data) => body.replaceChildren(card(sectionHeader('Canal de atualização', 'A atualização efetiva é executada pelo agente de implantação.'), row('Estado', badge(data.status)), row('Canal', data.channel || 'stable'), row('Versão disponível', data.version || data.latestVersion || data.latest_version || '—'), row('Publicada em', data.publishedAt || data.published_at ? new Date(data.publishedAt || data.published_at).toLocaleString('pt-BR') : '—'), data.notes ? el('div', { class: 'release-notes' }, el('strong', { text: 'Notas da versão' }), el('p', { text: String(data.notes) })) : null))).catch((error) => body.replaceChildren(alertBox(error.message || String(error))));
  return appShell(page, { title: 'Atualizações', subtitle: 'Sistema' });
}
function row(label, value) { return el('div', { class: 'info-row' }, el('span', { text: label }), value instanceof Node ? value : el('strong', { text: String(value) })); }
