import { api } from '../api/manager.js';
import { alertBox, badge, card, el, spinner } from '../core/dom.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';
export function renderSystem() {
  const page = el('div', { class: 'page' }, pageHeader('Saúde do Sistema', 'Diagnóstico da Manager, Engine e integrações técnicas.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  void api.health().then((data) => body.replaceChildren(
    el('div', { class: 'system-grid' },
      card(sectionHeader('Manager', 'Administração local'), info('Estado', badge(data.manager?.status)), info('Uptime', `${Math.floor(Number(data.manager?.uptime || 0) / 3600)}h`)),
      card(sectionHeader('Engine', 'Motor do Connect|API'), info('Estado', badge(data.engine?.status)), info('Versão', data.engine?.version || '—'), data.engine?.message ? info('Mensagem', data.engine.message) : null),
      card(sectionHeader('Serviços externos', 'Somente licenciamento, telemetria e releases.'), info('Licenciamento', data.integrations?.license ? 'Configurado' : 'Não configurado'), info('Telemetria', data.integrations?.telemetry ? 'Configurada' : 'Não configurada'), info('Releases', data.integrations?.releases ? 'Configurado' : 'Não configurado')),
    )
  )).catch((error) => body.replaceChildren(alertBox(error.message || String(error))));
  return appShell(page, { title: 'Saúde', subtitle: 'Sistema' });
}
function info(label, value) { return el('div', { class: 'info-row' }, el('span', { text: label }), value instanceof Node ? value : el('strong', { text: value })); }
