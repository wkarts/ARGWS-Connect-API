import { api } from '../api/manager.js';
import { alertBox, badge, card, el, metric, spinner } from '../core/dom.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';

function serviceRow(label, value, description) {
  return el('div', { class: 'service-row' }, el('div', {}, el('strong', { text: label }), el('span', { text: description })), badge(value));
}

export function renderDashboard() {
  const page = el('div', { class: 'page' }, pageHeader('Visão Geral', 'Acompanhe o Engine, conexões e serviços do Connect|API em uma única tela.'));
  const body = el('div', { class: 'center' }, spinner());
  page.append(body);
  void api.dashboard().then((data) => {
    const engineOnline = data.engine?.status === 'ok';
    body.replaceChildren(
      el('div', { class: 'metric-grid four' },
        metric('Engine', engineOnline ? 'Online' : 'Indisponível', `v${data.engine?.version || '—'}`, '◈'),
        metric('Instâncias', `${data.instances?.connected || 0}/${data.instances?.total || 0}`, 'conectadas', '◉'),
        metric('Mensagens', Number(data.totals?.messages || 0).toLocaleString('pt-BR'), 'armazenadas', '✉'),
        metric('Conversas', Number(data.totals?.chats || 0).toLocaleString('pt-BR'), 'registradas', '◌'),
      ),
      el('div', { class: 'dashboard-grid' },
        card(sectionHeader('Saúde dos serviços', 'Estado atual dos componentes administrativos.'), serviceRow('Manager', data.services?.manager?.status, 'Interface e API administrativa'), serviceRow('Engine', data.engine?.status, 'Motor de comunicação'), serviceRow('Licenciamento', data.services?.license?.status, 'Validação e direitos de uso'), serviceRow('Telemetria', data.services?.telemetry?.status, 'Somente dados técnicos'), serviceRow('Atualizações', data.services?.updates?.status, 'Canal de versões')), 
        card(sectionHeader('Resumo operacional', 'Dados agregados do ambiente local.'),
          el('div', { class: 'summary-list' },
            el('div', {}, el('span', { text: 'Contatos' }), el('strong', { text: Number(data.totals?.contacts || 0).toLocaleString('pt-BR') })),
            el('div', {}, el('span', { text: 'Instâncias conectadas' }), el('strong', { text: data.instances?.connected || 0 })),
            el('div', {}, el('span', { text: 'Instâncias desconectadas' }), el('strong', { text: data.instances?.disconnected || 0 })),
            el('div', {}, el('span', { text: 'Uptime do Engine' }), el('strong', { text: `${Math.floor(Number(data.engine?.uptime || 0) / 3600)}h` })),
          )),
      ),
    );
  }).catch((error) => body.replaceChildren(alertBox(error.message || String(error))));
  return appShell(page, { title: 'Visão Geral', subtitle: 'Operações' });
}
