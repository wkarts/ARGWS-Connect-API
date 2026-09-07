import { api } from '../api/manager.js';
import { alertBox, badge, card, el, spinner } from '../core/dom.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';
export function renderLicense() {
  const page = el('div', { class: 'page' }, pageHeader('Licença', 'Estado da licença desta instalação do Connect|API.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  void api.license().then((data) => body.replaceChildren(card(sectionHeader('Connect|API', 'Licenciamento desta instalação'), row('Estado', badge(data.status)), row('Instalação', data.installationId || data.installation_id || '—'), row('Edição', data.edition || data.plan || '—'), row('Validade', data.expiresAt || data.expires_at ? new Date(data.expiresAt || data.expires_at).toLocaleDateString('pt-BR') : '—'), data.modules ? el('div', { class: 'top-gap' }, el('strong', { text: 'Recursos licenciados' }), el('div', { class: 'chip-grid top-gap small' }, ...Object.entries(data.modules).filter(([, enabled]) => enabled).map(([name]) => el('span', { class: 'chip', text: name })))) : null))).catch((error) => body.replaceChildren(alertBox(error.message || String(error))));
  return appShell(page, { title: 'Licença', subtitle: 'Sistema' });
}
function row(label, value) { return el('div', { class: 'info-row' }, el('span', { text: label }), value instanceof Node ? value : el('strong', { text: String(value) })); }
