import { api } from '../api/manager.js';
import { alertBox, badge, card, el, spinner } from '../core/dom.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';

export function renderChannels() {
  const page = el('div', { class: 'page' }, pageHeader('Canais', 'Visão consolidada dos canais de comunicação configurados.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  void api.instances().then((items) => {
    const groups = new Map();
    items.forEach((item) => { const key = item.integration || 'UNKNOWN'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
    body.replaceChildren(el('div', { class: 'channel-grid' }, ...[...groups.entries()].map(([key, list]) => card(sectionHeader(label(key), `${list.length} instância(s)`), el('div', { class: 'summary-list' }, ...list.map((item) => el('a', { href: `/manager/instances/${encodeURIComponent(item.id || item.instanceId || item.name)}`, dataset: { nav: '1' } }, el('span', { text: item.name || item.instanceName }), badge(item.connectionStatus))))))));
  }).catch((error) => body.replaceChildren(alertBox(error.message || String(error))));
  return appShell(page, { title: 'Canais', subtitle: 'Comunicação' });
}
function label(key) { return ({ 'WHATSAPP-BAILEYS': 'WhatsApp — Baileys', 'WHATSAPP-ZAPO': 'WhatsApp — Zapo', 'WHATSAPP-BUSINESS': 'WhatsApp — Meta Cloud' })[key] || key; }
