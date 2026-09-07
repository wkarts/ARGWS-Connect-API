import { alertBox, badge, button, card, el, field, input, spinner } from '../core/dom.js';
import { acceptCall, endCall, listCalls, muteCall, offerCall, rejectCall } from '../api/calls.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

const MEDIA_SAMPLE_RATE = 16000;
const WS_OPEN = 1;

function normalizePhone(value) {
  return [...String(value || '')].filter((char) => char >= '0' && char <= '9').join('');
}

function peer(call) {
  const value = call?.displayPeerJid || call?.peerJidAlt || call?.callerPn || call?.peerJid || call?.peer || '';
  return String(value).replace(/@.+$/, '') || 'Desconhecido';
}

function mediaUrl(apiUrl) {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/voice/media';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function downsample(input, inputRate) {
  if (inputRate === MEDIA_SAMPLE_RATE) return new Float32Array(input);
  const ratio = inputRate / MEDIA_SAMPLE_RATE;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) total += input[cursor];
    output[index] = total / Math.max(1, end - start);
  }
  return output;
}

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page softphone-page' });
  const feedback = el('div');
  const callsNode = el('div', { class: 'softphone-calls' }, spinner());
  const number = input('', { type: 'tel', inputmode: 'numeric', placeholder: '5575999999999' });
  let loading = false;
  let polling;
  let media = null;

  function closeMedia() {
    if (!media) return;
    media.processor?.disconnect();
    media.source?.disconnect();
    media.stream?.getTracks?.().forEach((track) => track.stop());
    if (media.ws?.readyState === WebSocket.OPEN || media.ws?.readyState === WebSocket.CONNECTING) media.ws.close();
    void media.context?.close?.();
    media = null;
  }

  function playPcm(context, playback, payload) {
    const samples = new Float32Array(payload);
    if (!samples.length) return;
    const audioBuffer = context.createBuffer(1, samples.length, MEDIA_SAMPLE_RATE);
    audioBuffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    playback.nextAt = Math.max(playback.nextAt, context.currentTime + 0.03);
    source.start(playback.nextAt);
    playback.nextAt += audioBuffer.duration;
  }

  async function openMedia(callId) {
    if (media?.callId === callId) return;
    closeMedia();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const AudioContextRef = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextRef) throw new Error('Este navegador não oferece AudioContext.');
    const context = new AudioContextRef();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const ws = new WebSocket(mediaUrl(session.apiUrl));
    ws.binaryType = 'arraybuffer';
    const playback = { nextAt: context.currentTime };

    media = { callId, stream, context, source, processor, ws, playback };

    processor.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);
      if (ws.readyState !== WS_OPEN) return;
      const samples = downsample(event.inputBuffer.getChannelData(0), context.sampleRate);
      ws.send(samples.buffer);
    };
    source.connect(processor);
    processor.connect(context.destination);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          instanceName: instance.name || instance.instanceName,
          callId,
          token: instance.token,
        }),
      );
    };
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') {
          feedback.replaceChildren(alertBox('Áudio conectado ao navegador.', 'success'));
        } else if (message.type === 'error') {
          feedback.replaceChildren(alertBox(message.message || 'Erro no canal de áudio.'));
        }
        return;
      }
      playPcm(context, playback, event.data);
    };
    ws.onclose = (event) => {
      if (media?.callId === callId && event.code !== 1000) {
        feedback.replaceChildren(alertBox(`Canal de áudio fechado (${event.code}).`));
      }
    };
    ws.onerror = () => feedback.replaceChildren(alertBox('Falha ao conectar o canal de áudio do Softphone.'));
  }

  async function act(action, call, value) {
    const callId = call.callId || call.id;
    try {
      feedback.replaceChildren();
      if (action === 'accept') {
        await acceptCall(session, instance, callId);
        await openMedia(callId);
      }
      if (action === 'reject') await rejectCall(session, instance, callId);
      if (action === 'end') {
        await endCall(session, instance, callId);
        if (media?.callId === callId) closeMedia();
      }
      if (action === 'mute') {
        await muteCall(session, instance, callId, value);
        if (media?.callId === callId) {
          media.stream.getAudioTracks().forEach((track) => {
            track.enabled = !value;
          });
        }
      }
      if (action === 'media') await openMedia(callId);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw(calls) {
    callsNode.replaceChildren();
    if (!calls.length) {
      callsNode.append(
        el(
          'div',
          { class: 'softphone-idle' },
          el('strong', { text: 'Softphone disponível' }),
          el('span', { text: 'Faça uma chamada ou aguarde uma chamada recebida.' }),
        ),
      );
      return;
    }

    calls.forEach((call) => {
      const callId = call.callId || call.id;
      const muted = Boolean(call.muted ?? call.stateData?.audioMuted);
      const state = String(call.state || call.stateData?.state || 'unknown');
      const actions = [];
      if (call.canAccept) {
        actions.push(button('Atender + áudio', { class: 'primary', onclick: () => act('accept', call) }));
      }
      if (call.canReject) actions.push(button('Recusar', { class: 'danger', onclick: () => act('reject', call) }));
      if (!call.canAccept && !media) {
        actions.push(button('Conectar áudio', { class: 'primary', onclick: () => act('media', call) }));
      }
      actions.push(button(muted ? 'Ativar microfone' : 'Silenciar', { onclick: () => act('mute', call, !muted) }));
      actions.push(button('Encerrar', { class: 'danger', onclick: () => act('end', call) }));

      callsNode.append(
        card(
          el(
            'div',
            { class: 'softphone-call-head' },
            el(
              'div',
              { class: 'softphone-peer' },
              el('span', { class: 'softphone-peer-icon', text: '☎' }),
              el(
                'div',
                {},
                el('strong', { text: peer(call) }),
                el('small', { text: call.direction === 'incoming' ? 'Chamada recebida' : 'Chamada efetuada' }),
              ),
            ),
            badge(state),
          ),
          el('div', { class: 'softphone-call-actions' }, ...actions),
        ),
      );
    });
  }

  async function reload({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    if (!silent) callsNode.replaceChildren(spinner());
    try {
      const data = await listCalls(session, instance);
      const calls = Array.isArray(data) ? data : data?.calls || [];
      draw(calls);
      if (media && !calls.some((call) => String(call.callId || call.id) === media.callId)) closeMedia();
    } catch (error) {
      if (!silent) callsNode.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loading = false;
    }
  }

  const dialer = el(
    'form',
    { class: 'softphone-dialer' },
    field('Número', number, 'DDI + DDD + número'),
    button('Ligar', { class: 'primary', type: 'submit' }),
  );
  dialer.onsubmit = async (event) => {
    event.preventDefault();
    const target = normalizePhone(number.value);
    if (!target) return;
    try {
      feedback.replaceChildren();
      const result = await offerCall(session, instance, target);
      number.value = '';
      const callId = result?.callId || result?.id;
      if (callId) await openMedia(callId);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };

  page.append(
    pageHeader('VoIP', 'Softphone web/PWA da instância. Áudio PCM trafega por canal dedicado.', [
      button('Atualizar', { onclick: reload }),
    ]),
    feedback,
    el(
      'section',
      { class: 'softphone-console' },
      el(
        'div',
        { class: 'softphone-display' },
        el('span', { text: 'Connect|API Softphone' }),
        el('strong', { text: 'WhatsApp Voice' }),
      ),
      dialer,
    ),
    callsNode,
    card(
      el('strong', { text: 'Vídeo' }),
      el('p', {
        class: 'muted',
        text: 'Ainda não habilitado: o provider Zapo atual expõe sinalização de vídeo, mas não um pipeline de mídia de vídeo utilizável pela Connect|API.',
      }),
    ),
  );

  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) {
      clearInterval(polling);
      closeMedia();
      return;
    }
    void reload({ silent: true });
  }, 2000);
  return instanceShell(instance, 'voip', page);
}
