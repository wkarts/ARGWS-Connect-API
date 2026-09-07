from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:140]!r}')
    file.write_text(text.replace(old, new, 1))


# Await and de-duplicate destructive instance removal.
replace_once(
    'src/api/services/monitor.service.ts',
    "  private readonly delInstanceTimeouts: Record<string, NodeJS.Timeout> = {};\n",
    "  private readonly delInstanceTimeouts: Record<string, NodeJS.Timeout> = {};\n  private readonly removeInstancePromises: Record<string, Promise<void>> = {};\n",
)

replace_once(
    'src/api/services/monitor.service.ts',
    """  public deleteInstance(instanceName: string) {
    try {
      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
    } catch (error) {
      this.logger.error(error);
    }
  }
""",
    """  public async removeInstanceNow(instanceName: string) {
    const runningRemoval = this.removeInstancePromises[instanceName];
    if (runningRemoval) return runningRemoval;

    const removal = (async () => {
      const current = this.waInstances[instanceName];
      try {
        await current?.sendDataWebhook(Events.REMOVE_INSTANCE, null);
        this.clearDelInstanceTime(instanceName);

        if (typeof current?.purgeProviderState === 'function') {
          await current.purgeProviderState();
        }

        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
      } finally {
        delete this.waInstances[instanceName];
        this.logger.warn(`Instance \"${instanceName}\" - REMOVED`);
      }
    })();

    this.removeInstancePromises[instanceName] = removal;
    try {
      await removal;
    } finally {
      delete this.removeInstancePromises[instanceName];
    }
  }

  public deleteInstance(instanceName: string) {
    void this.removeInstanceNow(instanceName).catch((error) => {
      this.logger.error({ localError: 'removeInstanceNow', instanceName, error });
    });
  }
""",
)

replace_once(
    'src/api/services/monitor.service.ts',
    """    this.eventEmitter.on('remove.instance', async (instanceName: string) => {
      try {
        await this.waInstances[instanceName]?.sendDataWebhook(Events.REMOVE_INSTANCE, null);

        this.clearDelInstanceTime(instanceName);

        const current = this.waInstances[instanceName];
        if (typeof current?.purgeProviderState === 'function') {
          try {
            await current.purgeProviderState();
          } catch (error) {
            this.logger.error({ localError: 'purgeProviderState', instanceName, error });
          }
        }

        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
      } finally {
        this.logger.warn(`Instance \"${instanceName}\" - REMOVED`);
      }

      try {
        delete this.waInstances[instanceName];
      } catch (error) {
        this.logger.error(error);
      }
    });
""",
    """    this.eventEmitter.on('remove.instance', (instanceName: string) => {
      void this.removeInstanceNow(instanceName).catch((error) => {
        this.logger.error({ localError: 'remove.instance', instanceName, error });
      });
    });
""",
)

replace_once(
    'src/api/controllers/instance.controller.ts',
    """      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
      return { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } };
""",
    """      await this.waMonitor.removeInstanceNow(instanceName);
      return { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } };
""",
)

# Optional fields must either be omitted or accept null from older clients.
replace_once(
    'src/validate/instance.schema.ts',
    "    number: { type: 'string', pattern: '^\\\\d+[\\\\.@\\\\w-]+' },\n    businessId: { type: 'string' },",
    "    number: { type: ['string', 'null'], pattern: '^\\\\d+[\\\\.@\\\\w-]+' },\n    businessId: { type: ['string', 'null'] },",
)

# Zapo: canonicalize LID to the PN alternate JID before any persistence or webhook.
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  private async handleIncomingMessage(event: any) {
    if (!event?.message || !event?.key?.remoteJid) return;

    const message = this.toJson(event.message);
    const messageType = this.detectMessageType(message);
    const messageRaw: any = {
      key: {
        id: event.key.id,
        remoteJid: event.key.remoteJid,
        remoteJidAlt: event.key.remoteJidAlt,
        fromMe: Boolean(event.key.fromMe),
        participant: event.key.participant,
        participantAlt: event.key.participantAlt,
      },
      pushName: event.pushName,
      participant: event.key.participant,
""",
    """  private async handleIncomingMessage(event: any) {
    if (!event?.message || !event?.key?.remoteJid) return;

    const rawRemoteJid = String(event.key.remoteJid);
    const remoteJidAlt = event.key.remoteJidAlt ? String(event.key.remoteJidAlt) : undefined;
    const canonicalRemoteJid =
      rawRemoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid') ? remoteJidAlt : rawRemoteJid;
    const rawParticipant = event.key.participant ? String(event.key.participant) : undefined;
    const participantAlt = event.key.participantAlt ? String(event.key.participantAlt) : undefined;
    const canonicalParticipant =
      rawParticipant?.endsWith('@lid') && participantAlt && !participantAlt.endsWith('@lid')
        ? participantAlt
        : rawParticipant;

    const message = this.toJson(event.message);
    const messageType = this.detectMessageType(message);
    const messageRaw: any = {
      key: {
        id: event.key.id,
        remoteJid: canonicalRemoteJid,
        remoteJidAlt,
        fromMe: Boolean(event.key.fromMe),
        participant: canonicalParticipant,
        participantAlt,
      },
      pushName: event.pushName,
      participant: canonicalParticipant,
""",
)

replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }
  }
""",
    """    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }

    if (rawRemoteJid !== canonicalRemoteJid) {
      await Promise.all([
        this.prismaRepository.chat.deleteMany({ where: { instanceId: this.instanceId, remoteJid: rawRemoteJid } }),
        this.prismaRepository.contact.deleteMany({ where: { instanceId: this.instanceId, remoteJid: rawRemoteJid } }),
      ]);
    }
  }
""",
)

# Persist account profile picture for the Manager when Zapo is connected.
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    if (credentials?.meJid) {
      this.instance.wuid = credentials.meJid;
      this.instance.ownerJid = credentials.meJid;
      this.instance.profileName = credentials.meDisplayName ?? this.instance.profileName;
    }

    await this.persistConnectionState(state);
""",
    """    if (credentials?.meJid) {
      this.instance.wuid = credentials.meJid;
      this.instance.ownerJid = credentials.meJid;
      this.instance.profileName = credentials.meDisplayName ?? this.instance.profileName;
      if (state === 'open') {
        const picture = await this.client.profile.getProfilePicture(credentials.meJid, 'image').catch(() => null);
        this.instance.profilePictureUrl = picture?.url ?? this.instance.profilePictureUrl;
      }
    }

    await this.persistConnectionState(state);
""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """          ownerJid: this.instance.ownerJid,
          profileName: this.instance.profileName,
""",
    """          ownerJid: this.instance.ownerJid,
          profileName: this.instance.profileName,
          profilePicUrl: this.instance.profilePictureUrl,
""",
)

# Manager: instances page with UUID tokens, secret-by-default token and distinct empty/search states.
Path('manager/src/pages/instances.js').write_text(r'''import {
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
''')

# Dashboard: hide tokens, support copy/reveal and close connection modal once provider opens.
Path('manager/src/pages/dashboard.js').write_text(r'''import { alertBox, badge, button, card, el, modal } from '../core/dom.js';
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
''')

# Calls/VoIP Manager API.
Path('manager/src/api/calls.js').write_text(r'''import { request } from './client.js';

const nameOf = (instance) => instance.name || instance.instanceName;
export const listCalls = (session, instance) =>
  request(session, `/call/list/${encodeURIComponent(nameOf(instance))}`, {}, instance.token);
export const offerCall = (session, instance, number) =>
  request(session, `/call/offer/${encodeURIComponent(nameOf(instance))}`, {
    method: 'POST',
    data: { number, isVideo: false },
  }, instance.token);
export const acceptCall = (session, instance, callId) =>
  request(session, `/call/accept/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId } }, instance.token);
export const rejectCall = (session, instance, callId) =>
  request(session, `/call/reject/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId } }, instance.token);
export const endCall = (session, instance, callId) =>
  request(session, `/call/end/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId } }, instance.token);
export const muteCall = (session, instance, callId, muted) =>
  request(session, `/call/mute/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId, muted } }, instance.token);
''')

Path('manager/src/pages/calls.js').write_text(r'''import { alertBox, badge, button, card, el, field, input, spinner } from '../core/dom.js';
import { acceptCall, endCall, listCalls, muteCall, offerCall, rejectCall } from '../api/calls.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function peer(call) {
  return String(call?.peerJid || call?.peer || '').replace(/@.+$/, '') || 'Desconhecido';
}

export function renderCalls(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page calls-page' });
  const feedback = el('div');
  const list = el('div', { class: 'call-list' });
  const number = input('', { type: 'tel', inputmode: 'numeric', placeholder: '5575999999999' });
  let loading = false;
  let polling;

  async function act(action, callId, value) {
    try {
      if (action === 'accept') await acceptCall(session, instance, callId);
      if (action === 'reject') await rejectCall(session, instance, callId);
      if (action === 'end') await endCall(session, instance, callId);
      if (action === 'mute') await muteCall(session, instance, callId, value);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw(calls) {
    list.replaceChildren();
    if (!calls.length) {
      list.append(
        el(
          'div',
          { class: 'empty small' },
          el('strong', { text: 'Nenhuma chamada ativa' }),
          el('span', { text: 'As chamadas WhatsApp via Zapo aparecerão aqui.' }),
        ),
      );
      return;
    }
    calls.forEach((call) => {
      const callId = call.callId || call.id;
      const state = call.state || call.stateData?.state || 'unknown';
      const actions = [];
      if (call.canAccept) actions.push(button('Atender', { class: 'primary', onclick: () => act('accept', callId) }));
      if (call.canReject) actions.push(button('Recusar', { class: 'danger', onclick: () => act('reject', callId) }));
      actions.push(button('Silenciar', { onclick: () => act('mute', callId, true) }));
      actions.push(button('Encerrar', { class: 'danger', onclick: () => act('end', callId) }));
      list.append(
        card(
          el(
            'div',
            { class: 'call-row' },
            el(
              'div',
              { class: 'call-peer' },
              el('span', { class: 'call-icon', text: call.direction === 'incoming' ? '↙' : '↗' }),
              el(
                'div',
                {},
                el('strong', { text: peer(call) }),
                el('small', { text: call.direction === 'incoming' ? 'Recebida' : 'Efetuada' }),
              ),
            ),
            badge(state),
            el('div', { class: 'actions' }, ...actions),
          ),
        ),
      );
    });
  }

  async function reload({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    if (!silent) list.replaceChildren(el('div', { class: 'center' }, spinner()));
    try {
      const data = await listCalls(session, instance);
      draw(Array.isArray(data) ? data : data?.calls || []);
    } catch (error) {
      if (!silent) list.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loading = false;
    }
  }

  const callForm = el(
    'form',
    { class: 'call-dialer' },
    field('Número para chamada', number),
    button('Ligar', { class: 'primary', type: 'submit' }),
  );
  callForm.onsubmit = async (event) => {
    event.preventDefault();
    const target = number.value.replace(/\D/g, '');
    if (!target) return;
    feedback.replaceChildren();
    try {
      await offerCall(session, instance, target);
      number.value = '';
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };

  page.append(
    pageHeader('Chamadas WhatsApp', 'Controle de chamadas de voz nativas do provider Zapo.', [
      button('Atualizar', { onclick: reload }),
    ]),
    feedback,
    card(callForm),
    list,
  );
  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) return clearInterval(polling);
    void reload({ silent: true });
  }, 2500);
  return instanceShell(instance, 'calls', page);
}
''')

Path('manager/src/pages/voip.js').write_text(r'''import { alertBox, badge, button, card, el, spinner } from '../core/dom.js';
import { listCalls } from '../api/calls.js';
import { navigate } from '../core/router.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page' });
  const status = el('div', { class: 'voip-status' }, spinner());

  async function reload() {
    try {
      const calls = await listCalls(session, instance);
      const active = Array.isArray(calls) ? calls.length : calls?.calls?.length || 0;
      status.replaceChildren(
        card(el('span', { class: 'muted', text: 'Provider' }), el('strong', { text: 'Zapo' })),
        card(
          el('span', { class: 'muted', text: 'Voz WhatsApp' }),
          badge(instance.connectionStatus === 'open' ? 'open' : 'close'),
        ),
        card(el('span', { class: 'muted', text: 'Chamadas ativas' }), el('strong', { text: String(active) })),
        card(el('span', { class: 'muted', text: 'Vídeo' }), el('strong', { text: 'Ainda não habilitado' })),
      );
    } catch (error) {
      status.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  page.append(
    pageHeader(
      'VoIP',
      'Camada de voz WhatsApp da instância. O áudio permanece no plano de mídia e não é enviado pelo EventManager.',
      [button('Atualizar', { onclick: reload })],
    ),
    el(
      'div',
      { class: 'voip-hero' },
      el(
        'div',
        {},
        el('h2', { text: 'Zapo VoIP' }),
        el('p', {
          class: 'muted',
          text: 'Chamadas de voz nativas do WhatsApp, prontas para integração com o Voice Core/PBX.',
        }),
      ),
      button('Abrir chamadas', {
        class: 'primary',
        onclick: () =>
          navigate(`/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`),
      }),
    ),
    status,
  );
  void reload();
  return instanceShell(instance, 'voip', page);
}
''')

# Sidebar: voice menus only when the instance provider actually supports them.
Path('manager/src/components/shell.js').write_text(r'''import { badge, button, el } from '../core/dom.js';
import { link, navigate } from '../core/router.js';
import { runtimeConfig } from '../core/runtime-config.js';
import { clearSession, getLocale, getTheme, loadSession, setLocale, setTheme } from '../core/session.js';

export function header(instance) {
  const session = loadSession();
  const theme = getTheme();
  const container = el('header', { class: 'topbar' });
  const brand = el(
    'a',
    { class: 'brand', href: '/manager/', dataset: { nav: '1' } },
    el('img', {
      src:
        theme === 'dark'
          ? '/assets/images/argws-connect-logo-dark.svg'
          : '/assets/images/argws-connect-logo-horizontal.svg',
      alt: 'Connect|API',
    }),
  );
  container.append(
    brand,
    el(
      'div',
      { class: 'topbar-meta' },
      instance ? el('span', { class: 'instance-pill', text: instance.name }) : null,
      el('span', { class: 'version-pill', text: `v${session?.version || '—'}` }),
    ),
    el('div', { class: 'topbar-spacer' }),
  );
  const actions = el('div', { class: 'topbar-actions' });
  if (runtimeConfig.locale.extraLocalesEnabled && runtimeConfig.locale.enabledLocales.length > 1) {
    const current = getLocale() || runtimeConfig.locale.defaultLocale;
    const selector = el('select', { class: 'input compact' });
    runtimeConfig.locale.enabledLocales.forEach((locale) =>
      selector.append(el('option', { value: locale, text: locale, selected: locale === current })),
    );
    selector.onchange = () => {
      setLocale(selector.value);
      location.reload();
    };
    actions.append(selector);
  }
  actions.append(
    button(theme === 'dark' ? '☀' : '☾', {
      class: 'icon-btn',
      onclick: () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        location.reload();
      },
    }),
    button('↪', {
      class: 'icon-btn danger',
      onclick: () => {
        clearSession();
        navigate('/manager/login');
      },
    }),
  );
  container.append(actions);
  return container;
}

function navigationGroups(instance) {
  const principal = [
    ['Visão geral', 'dashboard', '◫'],
    ['Chat', 'chat', '◉'],
  ];
  if (instance.integration === 'WHATSAPP-ZAPO') {
    principal.push(['Chamadas WhatsApp', 'calls', '☎'], ['VoIP', 'voip', '◍']);
  }
  return [
    ['Principal', principal],
    ['Configurações', [['Comportamento', 'settings', '⚙'], ['Proxy', 'proxy', '⇄']]],
    ['Eventos', [['Webhook', 'webhook', '⌁'], ['WebSocket', 'websocket', '◌'], ['RabbitMQ', 'rabbitmq', '▤'], ['SQS', 'sqs', '▦']]],
    ['Integrações', [['Chatwoot', 'chatwoot', '⌘'], ['Typebot', 'typebot', '◆'], ['OpenAI', 'openai', '◆'], ['Dify', 'dify', '◆'], ['n8n', 'n8n', '◆'], ['ConnectAI', 'connectAI', '◆'], ['ConnectBot', 'connectBot', '◆'], ['Flowise', 'flowise', '◆']]],
  ];
}

export function sidebar(instance, active) {
  const session = loadSession();
  const aside = el('aside', { class: 'sidebar' });
  navigationGroups(instance).forEach(([title, items]) => {
    const section = el('section', {}, el('h4', { text: title }));
    items.forEach(([label, path, icon]) => {
      const a = link(
        '',
        `/manager/instance/${instance.id || instance.instanceId}/${path}`,
        `nav-item ${active === path ? 'active' : ''}`,
      );
      a.append(el('span', { class: 'nav-icon', text: icon }), el('span', { text: label }));
      section.append(a);
    });
    aside.append(section);
  });
  const docs = runtimeConfig.documentationUrl || session?.documentationUrl;
  if (docs) {
    aside.append(
      el(
        'a',
        { class: 'nav-item docs-link', href: docs, target: '_blank', rel: 'noreferrer' },
        el('span', { text: '↗' }),
        el('span', { text: 'Documentação' }),
      ),
    );
  }
  return aside;
}

export function pageHeader(title, description, actions = []) {
  return el(
    'div',
    { class: 'page-header' },
    el('div', {}, el('h1', { text: title }), el('p', { text: description || '' })),
    el('div', { class: 'actions' }, ...actions),
  );
}
export function managerShell(content) {
  return el('div', { class: 'app' }, header(), el('main', { class: 'manager-main' }, content));
}
export function instanceShell(instance, active, content) {
  return el(
    'div',
    { class: 'app' },
    header(instance),
    el('div', { class: 'instance-layout' }, sidebar(instance, active), el('main', { class: 'instance-main' }, content)),
  );
}
export function instanceStatus(instance) {
  return badge(instance.connectionStatus);
}
''')

# Route wiring.
main = Path('manager/src/main.js').read_text()
main = main.replace(
    "import { renderIntegration } from './pages/integration.js';\n",
    "import { renderIntegration } from './pages/integration.js';\nimport { renderCalls } from './pages/calls.js';\nimport { renderVoip } from './pages/voip.js';\n",
)
main = main.replace(
    """    } else if (configKinds.has(section)) {
      root.append(renderConfig(instance, section));
""",
    """    } else if (section === 'calls' && instance.integration === 'WHATSAPP-ZAPO') {
      root.append(renderCalls(instance));
    } else if (section === 'voip' && instance.integration === 'WHATSAPP-ZAPO') {
      root.append(renderVoip(instance));
    } else if (configKinds.has(section)) {
      root.append(renderConfig(instance, section));
""",
)
Path('manager/src/main.js').write_text(main)

# Chat API and WhatsApp-like frontend. The Manager also de-duplicates historical LID rows while backend canonicalization prevents new ones.
Path('manager/src/api/chat.js').write_text(r'''import { request, requestForm } from './client.js';
export async function findChats(session, instance) {
  const data = await request(
    session,
    `/chat/findChats/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { where: {} } },
    instance.token,
  );
  return Array.isArray(data) ? data : data ? data.records || data : [];
}
export async function findMessages(session, instance, remoteJid) {
  const data = await request(
    session,
    `/chat/findMessages/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { where: { key: { remoteJid } } } },
    instance.token,
  );
  return data?.messages?.records || (Array.isArray(data) ? data : []);
}
export async function fetchProfilePicture(session, instance, remoteJid) {
  const number = String(remoteJid || '').replace(/@.+$/, '');
  if (!number) return null;
  return request(
    session,
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { number } },
    instance.token,
  );
}
export const sendText = (session, instance, remoteJid, text) =>
  request(
    session,
    `/message/sendText/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { number: remoteJid.replace(/@.+$/, ''), text } },
    instance.token,
  );

export async function sendMedia(session, instance, remoteJid, file, caption = '') {
  const type = String(file.type || '').split('/')[0];
  const mediatype = ['image', 'video', 'audio'].includes(type) ? type : 'document';
  const form = new FormData();
  form.set('file', file, file.name || 'arquivo');
  form.set('number', remoteJid.replace(/@.+$/, ''));
  form.set('mediatype', mediatype);
  form.set('mimetype', file.type || 'application/octet-stream');
  form.set('fileName', file.name || 'arquivo');
  if (caption) form.set('caption', caption);
  return requestForm(
    session,
    `/message/sendMedia/${encodeURIComponent(instance.name || instance.instanceName)}`,
    form,
    {},
    instance.token,
  );
}
''')

Path('manager/src/pages/chat.js').write_text(r'''import { alertBox, button, el, input, spinner } from '../core/dom.js';
import { fetchProfilePicture, findChats, findMessages, sendMedia, sendText } from '../api/chat.js';
import { loadSession } from '../core/session.js';
import { instanceShell } from '../components/shell.js';

function rawChatJid(chat) {
  return chat?.remoteJid || chat?.id || chat?.key?.remoteJid || '';
}
function chatAltJid(chat) {
  return chat?.remoteJidAlt || chat?.lastMessage?.key?.remoteJidAlt || chat?.key?.remoteJidAlt || '';
}
function canonicalJid(chat) {
  const raw = rawChatJid(chat);
  const alt = chatAltJid(chat);
  return raw.endsWith('@lid') && alt && !alt.endsWith('@lid') ? alt : raw;
}
function chatName(chat) {
  const jid = canonicalJid(chat);
  return chat?.pushName || chat?.name || jid.split('@')[0] || 'Conversa';
}
function messageText(message) {
  const payload = message?.message || {};
  return (
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    (payload.imageMessage ? '📷 Imagem' : '') ||
    payload.videoMessage?.caption ||
    (payload.videoMessage ? '🎥 Vídeo' : '') ||
    payload.documentMessage?.fileName ||
    (payload.audioMessage ? '🎤 Áudio' : '') ||
    message?.messageType ||
    '[mídia]'
  );
}
function messageTimestamp(message) {
  const value = Number(message?.messageTimestamp || message?.timestamp || 0);
  if (!value) return '';
  const date = new Date(value > 10_000_000_000 ? value : value * 1000);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function renderChat(instance, initialJid = '', { embedded = false } = {}) {
  const session = loadSession();
  const layout = el('div', { class: 'chat-layout whatsapp-like' });
  const list = el('aside', { class: 'chat-list' });
  const conversation = el('section', { class: 'conversation' });
  const aliases = new Map();
  const avatarCache = new Map();
  let chats = [];
  let selected = initialJid;
  let polling;
  let loadingChats = false;
  let loadingMessages = false;

  function registerAliases(chat) {
    const canonical = canonicalJid(chat);
    if (!canonical) return;
    const set = aliases.get(canonical) || new Set();
    [rawChatJid(chat), chatAltJid(chat), canonical].filter(Boolean).forEach((jid) => set.add(jid));
    aliases.set(canonical, set);
  }

  function dedupeChats(rows) {
    const map = new Map();
    rows.forEach((chat) => {
      registerAliases(chat);
      const jid = canonicalJid(chat);
      if (!jid) return;
      const current = map.get(jid);
      if (!current || new Date(chat.updatedAt || 0) > new Date(current.updatedAt || 0)) map.set(jid, chat);
    });
    return [...map.values()];
  }

  function avatar(chat, size = '') {
    const jid = canonicalJid(chat);
    const name = chatName(chat);
    const node = el('div', { class: `avatar ${size}`.trim(), text: name[0]?.toUpperCase() || '?' });
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid')) return node;
    const cached = avatarCache.get(jid);
    if (cached) {
      node.replaceChildren(el('img', { src: cached, alt: '' }));
      return node;
    }
    void fetchProfilePicture(session, instance, jid)
      .then((data) => {
        const url = data?.profilePictureUrl || data?.url || data?.profilePicture?.url;
        if (url && document.body.contains(node)) {
          avatarCache.set(jid, url);
          node.replaceChildren(el('img', { src: url, alt: '' }));
        }
      })
      .catch(() => undefined);
    return node;
  }

  async function loadChats({ silent = false } = {}) {
    if (loadingChats) return;
    loadingChats = true;
    if (!silent) {
      list.replaceChildren(
        el('div', { class: 'chat-list-head' }, el('strong', { text: 'Conversas' })),
        el('div', { class: 'center' }, spinner()),
      );
    }
    try {
      chats = dedupeChats(await findChats(session, instance));
      drawChats();
    } catch (error) {
      if (!silent) list.append(alertBox(error.message || String(error)));
    } finally {
      loadingChats = false;
    }
  }

  function drawChats() {
    const search = input('', { placeholder: 'Pesquisar ou iniciar nova conversa' });
    const rows = el('div', { class: 'chat-rows' });
    const header = el(
      'div',
      { class: 'chat-list-toolbar' },
      el('strong', { text: 'Conversas' }),
      button('↻', { class: 'icon-btn', onclick: () => loadChats() }),
    );
    const drawRows = () => {
      const term = search.value.trim().toLowerCase();
      rows.replaceChildren();
      const visible = chats.filter((chat) => `${chatName(chat)} ${canonicalJid(chat)}`.toLowerCase().includes(term));
      if (!visible.length) {
        rows.append(el('div', { class: 'empty small' }, el('span', { text: 'Nenhuma conversa.' })));
        return;
      }
      visible.forEach((chat) => {
        const jid = canonicalJid(chat);
        const preview = messageText(chat.lastMessage || {});
        const row = el(
          'button',
          {
            class: `chat-row ${selected === jid ? 'active' : ''}`,
            onclick: () => {
              selected = jid;
              history.replaceState(
                {},
                '',
                embedded
                  ? `/manager/embed-chat/${encodeURIComponent(jid)}`
                  : `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/chat/${encodeURIComponent(jid)}`,
              );
              drawChats();
              void loadMessages();
            },
          },
          avatar(chat),
          el(
            'div',
            { class: 'chat-row-body' },
            el(
              'div',
              { class: 'chat-row-top' },
              el('strong', { text: chatName(chat) }),
              el('small', { text: messageTimestamp(chat.lastMessage) }),
            ),
            el(
              'div',
              { class: 'chat-row-bottom' },
              el('span', { text: preview || jid.split('@')[0] }),
              Number(chat.unreadCount || 0) > 0
                ? el('b', { class: 'unread-badge', text: String(chat.unreadCount) })
                : null,
            ),
          ),
        );
        rows.append(row);
      });
    };
    search.addEventListener('input', drawRows);
    list.replaceChildren(header, el('div', { class: 'chat-search' }, search), rows);
    drawRows();
  }

  async function loadMessages({ silent = false } = {}) {
    if (loadingMessages || !selected) {
      if (!selected && !silent) {
        conversation.replaceChildren(
          el(
            'div',
            { class: 'empty conversation-empty' },
            el('strong', { text: 'Connect|API Chat' }),
            el('span', { text: 'Selecione uma conversa para começar.' }),
          ),
        );
      }
      return;
    }
    loadingMessages = true;
    const chat = chats.find((item) => canonicalJid(item) === selected) || { remoteJid: selected };
    const header = el(
      'div',
      { class: 'conversation-head' },
      el(
        'div',
        { class: 'conversation-person' },
        avatar(chat, 'large'),
        el(
          'div',
          {},
          el('strong', { text: chatName(chat) }),
          el('small', { text: selected.replace(/@.+$/, '') }),
        ),
      ),
      el(
        'div',
        { class: 'actions' },
        instance.integration === 'WHATSAPP-ZAPO'
          ? button('☎', {
              class: 'icon-btn',
              onclick: () =>
                (location.href = `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`),
            })
          : null,
        button('↻', { class: 'icon-btn', onclick: () => loadMessages() }),
      ),
    );
    const messages = el('div', { class: 'messages' }, silent ? null : spinner());
    const text = input('', { placeholder: 'Digite uma mensagem', autocomplete: 'off' });
    const file = el('input', { type: 'file', class: 'file-input' });
    const attach = button('＋', { class: 'icon-btn', onclick: () => file.click() });
    const formFeedback = el('div', { class: 'composer-feedback' });
    const form = el(
      'form',
      { class: 'composer' },
      attach,
      file,
      text,
      button('➤', { class: 'primary send-btn', type: 'submit' }),
    );
    const composer = el('div', {}, formFeedback, form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = text.value.trim();
      const attachment = file.files?.[0];
      if (!body && !attachment) return;
      formFeedback.replaceChildren();
      try {
        if (attachment) await sendMedia(session, instance, selected, attachment, body);
        else await sendText(session, instance, selected, body);
        text.value = '';
        file.value = '';
        await loadMessages();
      } catch (error) {
        formFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
    if (!silent) conversation.replaceChildren(header, messages, composer);
    try {
      const ids = [...(aliases.get(selected) || new Set([selected]))];
      const batches = await Promise.all(ids.map((jid) => findMessages(session, instance, jid).catch(() => [])));
      const unique = new Map();
      batches.flat().forEach((message) =>
        unique.set(message.id || message.key?.id || JSON.stringify(message.key), message),
      );
      const rows = [...unique.values()].sort(
        (a, b) => Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0),
      );
      const target = silent ? conversation.querySelector('.messages') : messages;
      if (target) renderMessageRows(target, rows);
    } catch (error) {
      if (!silent) messages.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loadingMessages = false;
    }
  }

  function renderMessageRows(target, rows) {
    target.replaceChildren();
    rows.forEach((message) =>
      target.append(
        el(
          'div',
          { class: `bubble ${message.key?.fromMe ? 'mine' : ''}` },
          el('span', { text: messageText(message) }),
          el('small', { text: messageTimestamp(message) }),
        ),
      ),
    );
    target.scrollTop = target.scrollHeight;
  }

  layout.append(list, conversation);
  void loadChats().then(() => loadMessages());
  polling = setInterval(() => {
    if (!document.body.contains(layout)) {
      clearInterval(polling);
      return;
    }
    void loadChats({ silent: true });
    if (selected) void loadMessages({ silent: true });
  }, 4000);
  return embedded ? el('main', { class: 'embedded-chat' }, layout) : instanceShell(instance, 'chat', layout);
}
''')

# Append visual improvements, preserving canonical colors/branding.
css = Path('manager/src/styles/app.css').read_text()
css += r'''
.instance-empty-state{min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:var(--muted);padding:32px}.instance-empty-state[hidden]{display:none}.instance-empty-state strong{font-size:20px;color:var(--text)}.instance-empty-state .btn{margin-top:10px}.empty-state-icon{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;background:var(--surface2);color:var(--primary);font-size:30px;font-weight:300}.secret-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.secret-toggle{white-space:nowrap}.token-section{min-width:min(560px,100%)}.token-control{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}.token-control .token-line{margin:0;min-width:330px}.token-line.secret{letter-spacing:.04em}.instance-identity{display:flex;align-items:center;gap:11px}.instance-avatar,.profile-avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:0 0 auto}.instance-avatar.fallback,.profile-avatar.fallback{display:grid;place-items:center;background:var(--primary);color:#fff;font-weight:800}.profile-avatar{width:58px;height:58px}.profile-heading{display:flex;align-items:center;gap:14px}.profile-heading .page-header{flex:1;margin-bottom:22px}.avatar img{width:100%;height:100%;border-radius:inherit;object-fit:cover}.avatar.large{width:42px;height:42px}.whatsapp-like{background:#efeae2}.chat-list{background:var(--surface)}.chat-list-toolbar{height:64px;padding:12px 16px}.chat-search{padding:8px 12px;background:var(--surface)}.chat-search .input{border-radius:999px;background:var(--surface2);border:0}.chat-row{padding:10px 12px;min-height:66px}.chat-row-body{flex:1;min-width:0}.chat-row-top,.chat-row-bottom{display:flex;align-items:center;gap:8px;justify-content:space-between}.chat-row-top small{color:var(--muted);font-size:11px}.chat-row-bottom span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.unread-badge{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#25d366;color:#fff;display:grid;place-items:center;font-size:11px}.conversation-head{height:64px;background:var(--surface)}.conversation-person{display:flex;align-items:center;gap:10px}.conversation-person>div:last-child{display:flex;flex-direction:column}.conversation-person small{color:var(--muted)}.messages{background-color:#efeae2;background-image:radial-gradient(circle at 1px 1px,rgba(15,23,42,.035) 1px,transparent 0);background-size:18px 18px}.bubble{border:0;border-radius:8px 8px 8px 2px;box-shadow:0 1px 1px rgba(15,23,42,.08)}.bubble.mine{background:#d9fdd3;border-radius:8px 8px 2px 8px}.bubble small{display:block;text-align:right;color:var(--muted);font-size:10px;margin-top:3px}.composer{background:var(--surface);padding:10px 12px}.composer .input{border-radius:999px;background:var(--surface2);border:0}.send-btn{width:40px;border-radius:50%;padding:0}.conversation-empty{border:0}.call-dialer{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end}.call-list{display:flex;flex-direction:column;gap:12px;margin-top:16px}.call-row{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;align-items:center;gap:16px}.call-peer{display:flex;align-items:center;gap:12px}.call-peer>div{display:flex;flex-direction:column}.call-peer small{color:var(--muted)}.call-icon{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--surface2);font-size:20px}.voip-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px;border:1px solid var(--border);border-radius:14px;background:var(--surface);margin-bottom:16px}.voip-hero h2{margin-bottom:6px}.voip-hero p{margin:0}.voip-status{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.voip-status .card{display:flex;flex-direction:column;gap:8px}.voip-status strong{font-size:20px}:root[data-theme=dark] .whatsapp-like,:root[data-theme=dark] .messages{background:#0b141a}.status-unknown{background:var(--surface2);color:var(--muted)}
@media(max-width:900px){.call-dialer,.call-row{grid-template-columns:1fr}.voip-status{grid-template-columns:1fr 1fr}.profile-heading{align-items:flex-start}.token-control .token-line{min-width:0;width:100%}}
'''
Path('manager/src/styles/app.css').write_text(css)

# Regression guards.
check = Path('manager/scripts/check.mjs').read_text()
check += "\nconst instances=fs.readFileSync(path.join(src,'pages','instances.js'),'utf8'); if(!instances.includes('randomUUID().toUpperCase()'))throw new Error('Token novo deve preservar formato UUID com hifens.'); if(instances.includes('businessId: businessId.value.trim() || null'))throw new Error('businessId opcional nao pode ser enviado como null.'); if(!instances.includes('Nenhuma conexão configurada'))throw new Error('Estado vazio de instancias ausente.');\nconst shellVoice=fs.readFileSync(path.join(src,'components','shell.js'),'utf8'); if(!shellVoice.includes('Chamadas WhatsApp')||!shellVoice.includes(\"'VoIP'\"))throw new Error('Menus de voz Zapo ausentes.');\n"
Path('manager/scripts/check.mjs').write_text(check)
