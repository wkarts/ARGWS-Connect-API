import { api } from '../api/manager.js';
import { alertBox, badge, button, card, el, modal, spinner } from '../core/dom.js';
import { hasPermission } from '../core/session.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (value) => Number(value || 0).toLocaleString('pt-BR');

export function renderInstance(ref) {
  const page = el('div', { class: 'page' });
  const body = el('div', { class: 'center' }, spinner());
  page.append(body);

  async function load() {
    try {
      const item = await api.instance(ref);
      draw(item);
    } catch (error) {
      body.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw(item) {
    const feedback = el('div');
    const name = item.name || item.instanceName || ref;
    const connected = String(item.connectionStatus).toLowerCase() === 'open';
    body.replaceChildren(
      pageHeader(name, `${prettyIntegration(item.integration)}${item.profileName ? ` • ${item.profileName}` : ''}`, [badge(item.connectionStatus)]),
      feedback,
      el('div', { class: 'metric-grid four' },
        metricSmall('Contatos', fmt(item._count?.Contact), '☷'),
        metricSmall('Conversas', fmt(item._count?.Chat), '◌'),
        metricSmall('Mensagens', fmt(item._count?.Message), '✉'),
        metricSmall('Conexão', connected ? 'Ativa' : 'Inativa', '◎'),
      ),
      el('div', { class: 'dashboard-grid' },
        card(sectionHeader('Conexão', 'Estado e autenticação desta instância.'),
          infoRow('Canal', prettyIntegration(item.integration)),
          infoRow('Número', item.number || '—'),
          infoRow('Perfil', item.profileName || '—'),
          infoRow('Estado', connected ? 'Conectada' : 'Desconectada'),
          hasPermission('instances.manage') ? el('div', { class: 'actions wrap top-gap' },
            !connected ? button('Gerar QR Code', { class: 'primary', onclick: () => connect(false, item, feedback) }) : null,
            !connected && item.number ? button('Código de pareamento', { onclick: () => connect(true, item, feedback) }) : null,
            button('Reiniciar', { onclick: async () => { await run(() => api.restartInstance(ref), 'Instância reiniciada.', feedback); await load(); } }),
            connected ? button('Desconectar', { class: 'danger', onclick: async () => { await run(() => api.logoutInstance(ref), 'Instância desconectada.', feedback); await load(); } }) : null,
          ) : null),
        card(sectionHeader('Atalhos', 'Acesse rapidamente as operações da instância.'),
          el('div', { class: 'quick-links' },
            quick('Conversas', 'Mensagens e histórico', `/manager/conversations?instance=${encodeURIComponent(ref)}`, '◌'),
            quick('Chamadas & VoIP', 'Chamadas disponíveis no canal', `/manager/voice?instance=${encodeURIComponent(ref)}`, '☎'),
            quick('Automações', 'Bots e orquestrações', `/manager/studio?instance=${encodeURIComponent(ref)}`, '◇'),
            quick('Integrações', 'Serviços conectados', `/manager/integrations?instance=${encodeURIComponent(ref)}`, '⌘'),
          )),
      ),
      card(sectionHeader('Configuração operacional', 'Recursos técnicos associados à instância.'),
        el('div', { class: 'chip-grid' }, ['Webhook', 'WebSocket', 'RabbitMQ', 'SQS', 'Proxy', 'Chatwoot'].map((label) => el('span', { class: 'chip', text: label })))),
    );
  }

  async function connect(pairing, item, feedback) {
    feedback.replaceChildren();
    try {
      const data = await api.connectInstance(ref, { pairing, number: item.number || '' });
      if (pairing) {
        const code = data?.pairingCode || data?.qrcode?.pairingCode || data?.code;
        if (!code) throw new Error('Código de pareamento não retornado pelo Engine.');
        modal('Código de pareamento', el('div', { class: 'pairing-code', text: code }));
      } else {
        const image = data?.base64 || data?.qrcode?.base64;
        if (!String(image || '').startsWith('data:image')) throw new Error('QR Code ainda não disponível. Tente novamente.');
        modal('QR Code', el('div', { class: 'qr-wrap' }, el('img', { src: image, alt: 'QR Code' })));
      }
      for (let i = 0; i < 20; i += 1) {
        await sleep(1500);
        const fresh = await api.instance(ref).catch(() => null);
        if (fresh?.connectionStatus === 'open') { await load(); break; }
      }
    } catch (error) { feedback.replaceChildren(alertBox(error.message || String(error))); }
  }

  void load();
  return appShell(page, { title: 'Instância', subtitle: 'Comunicação' });
}
function prettyIntegration(value) { return ({ 'WHATSAPP-BAILEYS': 'WhatsApp • Baileys', 'WHATSAPP-ZAPO': 'WhatsApp • Zapo', 'WHATSAPP-BUSINESS': 'WhatsApp • Meta Cloud' })[value] || String(value || 'WhatsApp'); }
function metricSmall(label, value, icon) { return card(el('div', { class: 'metric-top' }, el('span', { class: 'metric-icon', text: icon })), el('strong', { class: 'metric-value', text: value }), el('span', { class: 'metric-label', text: label })); }
function infoRow(label, value) { return el('div', { class: 'info-row' }, el('span', { text: label }), el('strong', { text: value })); }
function quick(title, description, href, icon) { return el('a', { class: 'quick-link', href, dataset: { nav: '1' } }, el('span', { class: 'quick-icon', text: icon }), el('div', {}, el('strong', { text: title }), el('span', { text: description })), el('span', { text: '›' })); }
async function run(fn, success, feedback) { try { await fn(); feedback.replaceChildren(alertBox(success, 'success')); } catch (error) { feedback.replaceChildren(alertBox(error.message || String(error))); } }
