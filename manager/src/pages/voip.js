import { alertBox, badge, button, card, el, field, input, spinner } from '../core/dom.js';
import { acceptCall, endCall, listCalls, muteCall, offerCall, rejectCall } from '../api/calls.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function nameOf(instance) {
  return instance.name || instance.instanceName;
}

function callIdOf(call) {
  return String(call?.callId || call?.id || '');
}

function callState(call) {
  return String(call?.state || call?.stateData?.state || '').toLowerCase();
}

function peer(call) {
  const value = call?.displayPeerJid || call?.peerJidAlt || call?.callerPn || call?.peerJid || call?.peer || '';
  return String(value).replace(/@.+$/, '') || 'Desconhecido';
}

function stateLabel(state) {
  return {
    initiating: 'Iniciando',
    ringing: 'Chamando',
    incoming_ringing: 'Recebendo chamada',
    connecting: 'Conectando áudio',
    active: 'Em chamada',
    on_hold: 'Em espera',
    ended: 'Encerrada',
  }[String(state || '').toLowerCase()] || state || 'Desconhecido';
}

function float32ToBase64(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  return btoa(binary);
}

function base64ToFloat32(encoded) {
  const binary = atob(String(encoded || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const aligned = bytes.byteLength - (bytes.byteLength % 4);
  return new Float32Array(bytes.buffer.slice(0, aligned));
}

function resampleMono(input, sourceRate, targetRate = 16000) {
  if (!input?.length) return new Float32Array();
  if (sourceRate === targetRate) return new Float32Array(input);
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let source = start; source < end; source += 1) sum += input[source];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page softphone-page' });
  const status = el('div', { class: 'voip-status' }, spinner());
  const feedback = el('div');
  const callArea = el('div', { class: 'softphone-call-area' });
  const micState = el('span', { class: 'muted', text: 'Microfone não iniciado' });
  const mediaState = el('span', { class: 'muted', text: 'Áudio do navegador desconectado' });
  const number = input('', { type: 'tel', inputmode: 'numeric', placeholder: '5575999999999' });

  let calls = [];
  let polling = null;
  let socket = null;
  let selectedCallId = '';
  let subscribedCallId = '';
  let mediaStream = null;
  let audioContext = null;
  let captureSource = null;
  let captureProcessor = null;
  let captureSink = null;
  let nextPlaybackTime = 0;
  let micMuted = false;

  function activeCall() {
    if (selectedCallId) {
      const selected = calls.find((call) => callIdOf(call) === selectedCallId);
      if (selected && callState(selected) !== 'ended') return selected;
    }
    return (
      calls.find((call) => ['active', 'connecting', 'incoming_ringing', 'ringing', 'initiating'].includes(callState(call))) ||
      calls[0] ||
      null
    );
  }

  function stopCapture() {
    try {
      captureProcessor?.disconnect();
      captureSource?.disconnect();
      captureSink?.disconnect();
    } catch {
      // Audio graph may already be closed.
    }
    captureProcessor = null;
    captureSource = null;
    captureSink = null;
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    micState.textContent = 'Microfone não iniciado';
    micState.className = 'muted';
  }

  function unsubscribeVoice() {
    if (socket?.connected && subscribedCallId) socket.emit('voice:unsubscribe', { callId: subscribedCallId });
    subscribedCallId = '';
    mediaState.textContent = 'Áudio do navegador desconectado';
    mediaState.className = 'muted';
  }

  async function closeMedia() {
    unsubscribeVoice();
    stopCapture();
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    if (audioContext) {
      await audioContext.close().catch(() => undefined);
      audioContext = null;
    }
  }

  function playInboundFrame(payload) {
    if (!audioContext || payload?.callId !== subscribedCallId || !payload?.pcm) return;
    const samples = base64ToFloat32(payload.pcm);
    if (!samples.length) return;
    const sampleRate = Number(payload.sampleRate || 16000);
    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    const now = audioContext.currentTime;
    const when = Math.max(now + 0.02, nextPlaybackTime);
    source.start(when);
    nextPlaybackTime = when + buffer.duration;
  }

  function ensureSocket() {
    if (socket?.connected) return socket;
    if (typeof window.io !== 'function') throw new Error('Canal de mídia Socket.IO não está disponível neste servidor.');
    socket = window.io({
      transports: ['websocket', 'polling'],
      auth: { apikey: instance.token || session?.apiKey || session?.apikey || '' },
    });
    socket.on('voice:audio', playInboundFrame);
    socket.on('connect_error', (error) => {
      mediaState.textContent = error?.message || 'Falha ao conectar o canal de áudio';
      mediaState.className = 'error-text';
    });
    return socket;
  }

  async function ensureMicrophone() {
    if (mediaStream && audioContext) return;
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    audioContext = audioContext || new AudioContext();
    await audioContext.resume();
    captureSource = audioContext.createMediaStreamSource(mediaStream);
    captureProcessor = audioContext.createScriptProcessor(2048, 1, 1);
    captureSink = audioContext.createGain();
    captureSink.gain.value = 0;
    captureProcessor.onaudioprocess = (event) => {
      if (micMuted || !socket?.connected || !subscribedCallId) return;
      const inputSamples = event.inputBuffer.getChannelData(0);
      const pcm16k = resampleMono(inputSamples, audioContext.sampleRate, 16000);
      if (!pcm16k.length) return;
      socket.emit('voice:audio', {
        instanceName: nameOf(instance),
        callId: subscribedCallId,
        sampleRate: 16000,
        channels: 1,
        pcm: float32ToBase64(pcm16k),
      });
    };
    captureSource.connect(captureProcessor);
    captureProcessor.connect(captureSink);
    captureSink.connect(audioContext.destination);
    micState.textContent = 'Microfone ativo';
    micState.className = 'success-text';
  }

  async function subscribeToCall(callId) {
    if (!callId || subscribedCallId === callId) return;
    await ensureMicrophone();
    const activeSocket = ensureSocket();
    if (!activeSocket.connected) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tempo esgotado ao conectar o canal de áudio.')), 10000);
        activeSocket.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        activeSocket.once('connect_error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    }
    if (subscribedCallId) activeSocket.emit('voice:unsubscribe', { callId: subscribedCallId });
    await new Promise((resolve, reject) => {
      activeSocket.timeout(10000).emit(
        'voice:subscribe',
        { instanceName: nameOf(instance), callId },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.ok) return reject(new Error(result?.error || 'Não foi possível abrir o canal de áudio.'));
          resolve(result);
        },
      );
    });
    subscribedCallId = callId;
    nextPlaybackTime = audioContext?.currentTime || 0;
    mediaState.textContent = 'Áudio bidirecional conectado';
    mediaState.className = 'success-text';
  }

  async function callAction(action, call, value) {
    feedback.replaceChildren();
    try {
      const callId = callIdOf(call);
      if (action === 'accept') {
        await acceptCall(session, instance, callId);
        selectedCallId = callId;
      } else if (action === 'reject') {
        await rejectCall(session, instance, callId);
      } else if (action === 'end') {
        await endCall(session, instance, callId);
        if (subscribedCallId === callId) unsubscribeVoice();
      } else if (action === 'mute') {
        micMuted = Boolean(value);
        await muteCall(session, instance, callId, micMuted);
        micState.textContent = micMuted ? 'Microfone silenciado' : 'Microfone ativo';
        micState.className = micMuted ? 'muted' : 'success-text';
      }
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function drawCall() {
    callArea.replaceChildren();
    const call = activeCall();
    if (!call) {
      callArea.append(
        el(
          'div',
          { class: 'empty small' },
          el('strong', { text: 'Nenhuma chamada ativa' }),
          el('span', { text: 'Faça uma ligação ou aguarde uma chamada recebida.' }),
        ),
      );
      return;
    }

    selectedCallId = callIdOf(call);
    const state = callState(call);
    const muted = Boolean(call.muted ?? call.stateData?.audioMuted ?? micMuted);
    micMuted = muted;
    const actions = [];
    if (call.canAccept) actions.push(button('Atender', { class: 'primary', onclick: () => callAction('accept', call) }));
    if (call.canReject) actions.push(button('Recusar', { class: 'danger', onclick: () => callAction('reject', call) }));
    if (['active', 'connecting', 'on_hold'].includes(state)) {
      actions.push(
        button(subscribedCallId === selectedCallId ? 'Áudio conectado' : 'Conectar áudio', {
          class: subscribedCallId === selectedCallId ? '' : 'primary',
          disabled: subscribedCallId === selectedCallId,
          onclick: () => subscribeToCall(selectedCallId).catch((error) => feedback.replaceChildren(alertBox(error.message))),
        }),
      );
      actions.push(button(muted ? 'Ativar microfone' : 'Silenciar', { onclick: () => callAction('mute', call, !muted) }));
    }
    actions.push(button('Encerrar', { class: 'danger', onclick: () => callAction('end', call) }));

    callArea.append(
      card(
        el('div', { class: 'softphone-peer' }, el('strong', { text: peer(call) }), badge(stateLabel(state))),
        el('small', { class: 'muted', text: call.direction === 'incoming' ? 'Chamada recebida' : 'Chamada efetuada' }),
        el('div', { class: 'actions softphone-actions' }, ...actions),
      ),
    );

    if (state === 'active' && subscribedCallId !== selectedCallId) {
      void subscribeToCall(selectedCallId).catch((error) => {
        feedback.replaceChildren(alertBox(error.message || String(error)));
      });
    }
  }

  async function reload() {
    try {
      const data = await listCalls(session, instance);
      calls = Array.isArray(data) ? data : data?.calls || [];
      const active = calls.filter((call) => callState(call) !== 'ended').length;
      status.replaceChildren(
        card(el('span', { class: 'muted', text: 'Canal de voz' }), el('strong', { text: 'WhatsApp / Zapo' })),
        card(el('span', { class: 'muted', text: 'Conexão' }), badge(instance.connectionStatus)),
        card(el('span', { class: 'muted', text: 'Chamadas ativas' }), el('strong', { text: String(active) })),
        card(el('span', { class: 'muted', text: 'Vídeo' }), el('strong', { text: 'Não habilitado' })),
      );
      if (subscribedCallId && !calls.some((call) => callIdOf(call) === subscribedCallId && callState(call) !== 'ended')) {
        unsubscribeVoice();
      }
      drawCall();
    } catch (error) {
      status.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  const callForm = el(
    'form',
    { class: 'call-dialer softphone-dialer' },
    field('Número para chamada', number, 'Informe DDI + DDD + número.'),
    button('Ligar', { class: 'primary', type: 'submit' }),
  );
  callForm.onsubmit = async (event) => {
    event.preventDefault();
    const target = number.value.replace(/\D/g, '');
    if (!target) return;
    feedback.replaceChildren();
    try {
      const result = await offerCall(session, instance, target);
      selectedCallId = callIdOf(result) || selectedCallId;
      number.value = '';
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };

  page.append(
    pageHeader('VoIP', 'Softphone de voz da instância WhatsApp.', [button('Atualizar', { onclick: reload })]),
    feedback,
    el(
      'div',
      { class: 'voip-hero softphone-hero' },
      el(
        'div',
        {},
        el('h2', { text: 'Connect|API Softphone' }),
        el('p', {
          class: 'muted',
          text: 'Áudio bidirecional do navegador conectado diretamente ao plano de mídia do provider Zapo.',
        }),
        el('div', { class: 'softphone-media-state' }, micState, mediaState),
      ),
      el('div', { class: 'actions' }, button('Ativar microfone', { onclick: () => ensureMicrophone().catch((error) => feedback.replaceChildren(alertBox(error.message))) })),
    ),
    card(callForm),
    callArea,
    status,
  );

  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) {
      clearInterval(polling);
      void closeMedia();
      return;
    }
    void reload();
  }, 2000);
  return instanceShell(instance, 'voip', page);
}
