import { alertBox, badge, button, card, el, modal } from '../core/dom.js';
import { connectInstance, fetchInstances, logoutInstance, restartInstance } from '../api/instances.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tokenControl(value) {
  let visible = false;
  const code = el('code', { class: 'token-line secret', text: '••••••••-••••-••••-••••-••••••••••••' });
  const toggle = button('Mostrar', {
    onclick: () => {
      visible = !visible;
      code.textContent = visible ? value || '' : '••••••••-••••-••••-••••-••••••••••••';
      toggle.textContent = visible ? 'Ocultar' : 'Mostrar';
    },
  });
  const copy = button('Copiar', {
    onclick: async () => {
      await navigator.clipboard.writeText(value || '');
      copy.textContent = 'Copiado';
      setTimeout(() => (copy.textContent = 'Copiar'), 1200);
    },
  });
  return el('div', { class: 'token-control' }, code, el('div', { class: 'actions' }, toggle, copy));
}

export function renderDashboard(instance, reloadInstance) {
  const session = loadSession();
  const page = el('div', { class: 'page' });
  const error = el('div');
  const instanceId = instance.id || instance.instanceId;

  async function watchConnection(dialog) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (!document.body.contains(dialog.element)) return;
      await sleep(1500);
      try {
        const fresh = (await fetchInstances(session, instanceId))[0];
        if (fresh?.connectionStatus === 'open') {
          dialog.close();
          await reloadInstance();
          return;
        }
      } catch {
        // Provider is still negotiating the device link.
      }
    }
  }

  async function run(kind) {
    error.replaceChildren();
    try {
      if (kind === 'restart') {
        await restartInstance(session, instance);
        await reloadInstance();
        return;
      }
      if (kind === 'logout') {
        await logoutInstance(session, instance);
        await reloadInstance();
        return;
      }
      if (kind === 'qr') {
        const data = await connectInstance(session, instance, false);
        const dialog = showQr(data);
        void watchConnection(dialog);
        return;
      }
      if (kind === 'pair') {
        const data = await connectInstance(session, instance, true);
        const dialog = showPair(data);
        void watchConnection(dialog);
      }
    } catch (e) {
      error.replaceChildren(alertBox(e.message || String(e)));
    }
  }

  function showQr(data) {
    const code = data?.base64 || data?.qrcode?.base64 || data?.code || data?.qrcode?.code || '';
    const content = el('div', { class: 'qr-wrap' });
    if (String(code).startsWith('data:image')) content.append(el('img', { src: code, alt: 'QR Code' }));
    else content.append(el('pre', { class: 'qr-text', text: code || 'QR Code não retornado pela API' }));
    return modal('QR Code', content);
  }

  function showPair(data) {
    const code = data?.pairingCode || data?.qrcode?.pairingCode || data?.code || '';
    return modal('Código de pareamento', el('div', { class: 'pairing-code', text: code || 'Código não retornado' }));
  }

  const picture = instance.profilePicUrl
    ? el('img', { class: 'profile-avatar', src: instance.profilePicUrl, alt: '' })
    : el('div', {
        class: 'profile-avatar fallback',
        text: (instance.profileName || instance.name || '?')[0].toUpperCase(),
      });

  page.append(
    el(
      'div',
      { class: 'profile-heading' },
      picture,
      pageHeader(instance.name, instance.profileName || instance.ownerJid || 'Aguardando conexão', [
        badge(instance.connectionStatus),
      ]),
    ),
    error,
    card(
      el(
        'div',
        { class: 'dashboard-row' },
        el(
          'div',
          { class: 'token-section' },
          el('span', { class: 'muted', text: 'Token da instância' }),
          tokenControl(instance.token || ''),
        ),
        el(
          'div',
          { class: 'actions' },
          button('Atualizar', { onclick: reloadInstance }),
          button('Reiniciar', { onclick: () => run('restart') }),
          button('Desconectar', { class: 'danger', onclick: () => run('logout') }),
        ),
      ),
      instance.connectionStatus !== 'open'
        ? el(
            'div',
            { class: 'connect-panel' },
            el('strong', { text: 'Conecte o WhatsApp desta instância' }),
            el(
              'div',
              { class: 'actions' },
              button('Gerar QR Code', { class: 'primary', onclick: () => run('qr') }),
              instance.number ? button('Código de pareamento', { onclick: () => run('pair') }) : null,
            ),
          )
        : null,
    ),
    el(
      'div',
      { class: 'metric-grid' },
      metric('Contatos', instance._count?.Contact, '☷'),
      metric('Chats', instance._count?.Chat, '◉'),
      metric('Mensagens', instance._count?.Message, '✉'),
    ),
  );

  return instanceShell(instance, 'dashboard', page);
}

function metric(label, value, icon) {
  return card(
    el('span', { class: 'metric-icon', text: icon }),
    el('strong', { text: Number(value || 0).toLocaleString('pt-BR') }),
    el('span', { text: label }),
  );
}
