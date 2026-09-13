import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ts = createRequire(import.meta.url)('typescript')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
function load(source, globals = {}, dependencies = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module, exports: module.exports, Uint8Array, ArrayBuffer, DataView, BigInt, URL, Error, AbortController,
    require(name) { assert.ok(name in dependencies, `Unexpected module ${name}`); return dependencies[name] },
    ...globals,
  })
  return module.exports
}
const codec = load(read('src/services/video-frame.ts'))
const annexb = new Uint8Array([0, 0, 0, 1, 0x65, 0x88, 0x84])
const spsFrame = (profile, compatibility, level) => new Uint8Array([0, 0, 0, 1, 0x67, profile, compatibility, level, 0x80, 0, 0, 1, 0x65, 0x88, 0x84])
const drain = async () => { for (let n = 0; n < 6; n++) await Promise.resolve() }

test('CV binary framing preserves H.264 bytes, keyframe and microseconds above uint32', () => {
  const bytes = codec.encodeVideoFrame({ data: annexb, timestampUs: 12_345_678_910, keyFrame: true })
  const header = new DataView(bytes)
  assert.equal(header.getUint16(0), 0x4356)
  assert.equal(header.getBigUint64(4), 12345678910n)
  assert.equal(header.getUint32(12), annexb.length)
  const frame = codec.decodeVideoFrame(bytes)
  assert.deepEqual([...frame.data], [...annexb])
  assert.equal(frame.timestampUs, 12_345_678_910)
  assert.equal(frame.keyFrame, true)
})

test('CV rejects oversized, truncated, unknown versions/flags and unsafe timestamps', () => {
  assert.throws(() => codec.encodeVideoFrame({ data: annexb, timestampUs: -1, keyFrame: false }))
  assert.throws(() => codec.encodeVideoFrame({ data: annexb, timestampUs: 0, keyFrame: false }, 6))
  for (const corrupt of [
    view => view.setUint8(0, 0), view => view.setUint8(2, 2), view => view.setUint8(3, 2),
    view => view.setUint32(12, 100), view => view.setBigUint64(4, BigInt(Number.MAX_SAFE_INTEGER) + 1n),
  ]) {
    const packet = codec.encodeVideoFrame({ data: annexb, timestampUs: 0, keyFrame: false })
    corrupt(new DataView(packet))
    assert.throws(() => codec.decodeVideoFrame(packet))
  }
  assert.throws(() => codec.decodeVideoFrame(new ArrayBuffer(16)))
})

function harness({ supported = true, ready = true, cameraError = false, ticketStatus = 200, remoteSupported = true, decoderSupport } = {}) {
  let timerId = 0, now = 1000, getUserMediaCalls = 0
  const timers = new Map(), listeners = new Map(), encoders = [], decoders = [], sockets = [], requests = [], states = [], errors = [], frames = [], draws = []
  const track = { readyState: 'live', enabled: true, stopped: false, addEventListener() {}, removeEventListener() {}, stop() { this.stopped = true; this.readyState = 'ended' } }
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] }
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage(...args) { draws.push(args) } }) }
  class Encoder {
    state = 'unconfigured'; encodeQueueSize = 0; encoded = []
    static async isConfigSupported(config) { assert.equal(config.avc.format, 'annexb'); return { supported } }
    constructor(options) { this.options = options; encoders.push(this) }
    configure(config) { this.config = config; this.state = 'configured' }
    encode(frame, options) { this.encoded.push({ frame, options }) }
    close() { this.state = 'closed' }
  }
  class Decoder {
    state = 'unconfigured'; decodeQueueSize = 0; decoded = []
    static async isConfigSupported(config) {
      if (config.codec === 'avc1.42E01F') return { supported }
      return decoderSupport ? decoderSupport(config) : { supported: remoteSupported }
    }
    constructor(options) { this.options = options; decoders.push(this) }
    configure(config) { this.config = config; this.state = 'configured' }
    decode(chunk) { this.decoded.push(chunk); const frame = { displayWidth: 640, displayHeight: 480, closed: false, close() { this.closed = true } }; frames.push(frame); this.options.output(frame) }
    close() { this.state = 'closed' }
    reset() { this.state = 'unconfigured' }
  }
  class Socket {
    static OPEN = 1
    readyState = 1; bufferedAmount = 0; sent = []; closed = false
    constructor(url) { this.url = url; sockets.push(this); queueMicrotask(() => this.onopen?.()) }
    send(value) {
      this.sent.push(value)
      if (ready && typeof value === 'string' && JSON.parse(value).ticket) queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready', codec: 'h264', format: 'annexb' }) }))
    }
    close() { this.closed = true; this.readyState = 3 }
  }
  const api = load(read('src/services/video-media.ts'), {
    isSecureContext: true, VideoEncoder: Encoder, VideoDecoder: Decoder, WebSocket: Socket,
    VideoFrame: class { constructor(canvas, options) { this.timestamp = options.timestamp; this.closed = false; frames.push(this) } close() { this.closed = true } },
    EncodedVideoChunk: class { constructor(init) { Object.assign(this, init) } },
    performance: { now: () => now },
    navigator: { mediaDevices: { async getUserMedia(options) { getUserMediaCalls++; assert.equal(options.audio, false); if (cameraError) throw new Error('Câmera negada'); return stream } } },
    window: {
      setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id },
      clearTimeout(id) { timers.delete(id) },
      addEventListener(type, fn) { listeners.set(type, fn) }, removeEventListener(type) { listeners.delete(type) },
    },
    document: { createElement(tag) { return tag === 'video' ? { muted: false, playsInline: false, readyState: 4, async play() {}, pause() {}, srcObject: null } : canvas } },
    async fetch(url, init) {
      requests.push({ url, init })
      return { ok: ticketStatus === 200, async json() { return { ticket: 'single-use-ticket', codec: 'h264', format: 'annexb', width: 640, height: 480, maxFps: 30, bitrate: 800000, maxFrameBytes: 8388608 } } }
    },
  }, { './video-frame': codec })
  async function begin() {
    const preparation = await api.VideoMediaSession.prepare()
    const credentials = { apiBaseUrl: 'https://api.example.test/?secret=discard#fragment', instanceName: 'instance one', callId: 'call-a', token: 'private-instance-key' }
    // Production apiBaseUrl has no query; websocket must still discard all URL credentials.
    credentials.apiBaseUrl = 'https://api.example.test'
    const session = new api.VideoMediaSession(credentials, preparation, canvas, { onState: state => states.push(state), onError: error => errors.push(error) })
    return { session, preparation, credentials }
  }
  return { ...api, begin, track, timers, listeners, encoders, decoders, sockets, requests, states, errors, frames, draws, advance(ms) { now += ms }, getUserMediaCalls: () => getUserMediaCalls }
}

test('preflight verifies both codecs before requesting camera and leaves calls untouched when unsupported', async () => {
  const h = harness({ supported: false })
  await assert.rejects(h.VideoMediaSession.prepare(), /enviar e receber H.264/)
  assert.equal(h.getUserMediaCalls(), 0)
  assert.equal(h.requests.length, 0)
  assert.equal(h.sockets.length, 0)
  const denied = harness({ cameraError: true })
  await assert.rejects(denied.VideoMediaSession.prepare(), /Câmera negada/)
  assert.equal(denied.requests.length, 0)
})

test('session uses scoped one-use ticket in first WS control frame and transmits real encoder output', async () => {
  const h = harness(); const { session, credentials } = await h.begin()
  await session.start()
  const request = h.requests[0]
  assert.equal(request.url, 'https://api.example.test/call/videoMediaTicket/instance%20one')
  assert.equal(request.init.headers.apikey, 'private-instance-key')
  assert.equal(request.init.body, JSON.stringify({ callId: 'call-a' }))
  assert.equal(request.init.cache, 'no-store')
  assert.equal(String(h.sockets[0].url), 'wss://api.example.test/video/media')
  assert.deepEqual(JSON.parse(h.sockets[0].sent[0]), { ticket: 'single-use-ticket' })
  assert.equal(credentials.token, '')
  h.encoders[0].options.output({ type: 'key', timestamp: 1000000, byteLength: annexb.length, copyTo: out => out.set(annexb) })
  const binary = h.sockets[0].sent.find(value => value instanceof ArrayBuffer)
  assert.deepEqual([...codec.decodeVideoFrame(binary).data], [...annexb])
  assert.ok(h.encoders[0].encoded[0].frame.closed, 'Captured VideoFrame is released after encode')
  session.stop()
})

test('inbound delta waits for keyframe; decoded video draws to canvas and releases frame', async () => {
  const h = harness(); const { session } = await h.begin(); await session.start()
  const socket = h.sockets[0]
  socket.onmessage({ data: codec.encodeVideoFrame({ data: annexb, timestampUs: 123, keyFrame: false }) })
  assert.equal(h.decoders[0].decoded.length, 0)
  socket.onmessage({ data: codec.encodeVideoFrame({ data: annexb, timestampUs: 124, keyFrame: true }) })
  assert.equal(h.decoders[0].decoded.length, 1)
  assert.equal(h.decoders[0].decoded[0].timestamp, 124)
  assert.ok(h.frames.at(-1).closed)
  assert.equal(h.draws.at(-1)[0], h.frames.at(-1))
  session.stop()
})

test('backpressure drops stale encoded deltas until a new IDR, requests IDR on control and camera resume', async () => {
  const h = harness(); const { session } = await h.begin(); await session.start()
  const socket = h.sockets[0], encoder = h.encoders[0]
  const output = type => encoder.options.output({ type, timestamp: 1000, byteLength: annexb.length, copyTo: out => out.set(annexb) })
  output('key'); const before = socket.sent.length
  socket.bufferedAmount = 600 * 1024; output('delta'); socket.bufferedAmount = 0; output('delta')
  assert.equal(socket.sent.length, before)
  output('key'); assert.equal(socket.sent.length, before + 1)
  socket.onmessage({ data: JSON.stringify({ type: 'request_keyframe' }) })
  const tick = [...h.timers.values()].find(item => item.delay < 1000)
  h.advance(35); tick.fn()
  assert.equal(encoder.encoded.at(-1).options.keyFrame, true)
  session.setCameraEnabled(false); assert.equal(h.track.enabled, false)
  const encodedBefore = encoder.encoded.length; tick.fn(); assert.equal(encoder.encoded.length, encodedBefore)
  session.setCameraEnabled(true); tick.fn(); assert.equal(encoder.encoded.at(-1).options.keyFrame, true)
  session.stop()
})

test('disconnect/page exit stops camera, encoders, WS and timers without leaving media active', async () => {
  for (const disconnect of [h => h.sockets[0].onclose(), h => h.listeners.get('pagehide')()]) {
    const h = harness(); const { session } = await h.begin(); await session.start(); disconnect(h)
    assert.equal(h.track.stopped, true)
    assert.equal(h.encoders[0].state, 'closed')
    assert.equal(h.decoders[0].state, 'closed')
    assert.equal(h.sockets[0].closed, true)
    assert.equal(h.timers.size, 0)
    assert.equal(h.listeners.size, 0)
    session.stop()
  }
})

test('failed ticket and stalled WS release camera and reject start instead of false success', async () => {
  const denied = harness({ ticketStatus: 403 }); const a = await denied.begin()
  await assert.rejects(a.session.start(), /autorizar/)
  assert.equal(denied.track.stopped, true)
  const stalled = harness({ ready: false }); const b = await stalled.begin()
  const pending = b.session.start()
  for (let n = 0; n < 8; n++) await Promise.resolve()
  const timeout = [...stalled.timers.values()].find(item => item.delay === 15000)
  assert.ok(timeout); timeout.fn()
  await assert.rejects(pending, /encerrada/)
  assert.equal(stalled.track.stopped, true)
  assert.equal(stalled.states.includes('ready'), false)
})

test('404 video ticket releases camera and codecs without opening a socket or ending the call', async () => {
  const h = harness({ ticketStatus: 404 })
  const { session, credentials } = await h.begin()
  await assert.rejects(session.start(), /autorizar o vídeo/)
  assert.equal(h.track.stopped, true)
  assert.equal(h.encoders[0].state, 'closed')
  assert.equal(h.decoders[0].state, 'closed')
  assert.equal(h.sockets.length, 0)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].url, 'https://api.example.test/call/videoMediaTicket/instance%20one')
  assert.equal(credentials.token, '')
  assert.equal(h.states.at(-1), 'error')
  assert.equal(h.states.includes('ready'), false)
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners.size, 0)
})

test('Annex-B SPS extraction supports 3/4-byte start codes and rejects truncated or conflicting profiles', () => {
  assert.equal(codec.h264DecoderCodec(spsFrame(0x4d, 0x40, 0x1f)), 'avc1.4D401F')
  assert.equal(codec.h264DecoderCodec(spsFrame(0x64, 0, 0x28).slice(1)), 'avc1.640028')
  assert.equal(codec.h264DecoderCodec(annexb), null)
  assert.throws(() => codec.h264DecoderCodec(new Uint8Array([0, 0, 1, 0x67, 0x64])))
  assert.throws(() => codec.h264DecoderCodec(new Uint8Array([...spsFrame(0x4d, 0x40, 0x1f), ...spsFrame(0x64, 0, 0x28)])))
})

test('receiver derives Main/High profile from SPS and checks decoder support without changing local encoder', async () => {
  const h = harness(); const { session } = await h.begin(); await session.start()
  for (const [profile, compatibility, level, expected] of [[0x4d, 0x40, 0x1f, 'avc1.4D401F'], [0x64, 0, 0x28, 'avc1.640028']]) {
    h.sockets[0].onmessage({ data: codec.encodeVideoFrame({ data: spsFrame(profile, compatibility, level), timestampUs: profile * 1000, keyFrame: true }) })
    await drain()
    assert.equal(h.decoders[0].config.codec, expected)
    assert.equal(h.decoders[0].decoded.at(-1).type, 'key')
    assert.equal(h.encoders[0].config.codec, 'avc1.42E01F')
  }
  session.stop()
})

test('unsupported remote SPS ends only video with recoverable explanation; does not report ready remote frame', async () => {
  const h = harness({ remoteSupported: false }); const { session } = await h.begin(); await session.start()
  h.sockets[0].onmessage({ data: codec.encodeVideoFrame({ data: spsFrame(0x64, 0, 0x28), timestampUs: 1000, keyFrame: true }) })
  await drain()
  assert.equal(h.decoders[0].decoded.length, 0)
  assert.equal(h.states.at(-1), 'error')
  assert.match(h.errors.at(-1), /perfil H.264.*áudio continua/)
  assert.equal(h.track.stopped, true)
})

test('pending codec checks retain one frame, drop deltas and cannot revive a stopped session', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const h = harness({ decoderSupport: () => pending }); const { session } = await h.begin(); await session.start()
  const socket = h.sockets[0]
  socket.onmessage({ data: codec.encodeVideoFrame({ data: spsFrame(0x64, 0, 0x28), timestampUs: 1000, keyFrame: true }) })
  for (let i = 0; i < 20; i++) socket.onmessage({ data: codec.encodeVideoFrame({ data: annexb, timestampUs: i + 1001, keyFrame: false }) })
  assert.equal(h.decoders[0].decoded.length, 0)
  session.stop(); release({ supported: true }); await drain()
  assert.equal(h.decoders[0].state, 'closed')
  assert.equal(h.decoders[0].decoded.length, 0)
  assert.equal(h.states.at(-1), 'closed')
})

function viewHarness({ rejectCamera = false, videoSupported = true, offerDelay, actionDelay, videoStartError } = {}) {
  const requests = []
  const videoCallbacks = []
  const state = value => ({ value })
  const track = { stops: 0, stop() { this.stops++ } }
  const media = { stops: 0, muted: false, stop() { this.stops++ }, setMicMuted(muted) { this.muted = muted } }
  const video = { stops: 0, stop() { this.stops++ } }
  const source = read('src/views/VoiceView.vue').split('<script setup lang="ts">')[1].split('</script>')[0]
  const dependencies = {
    vue: { ref: state, shallowRef: state, computed: fn => ({ get value() { return fn() } }), nextTick: async () => {}, onBeforeUnmount() {}, onMounted() {}, watch() {} },
    'vue-router': { useRoute: () => ({ query: { instance: 'i1' } }), useRouter: () => ({}) },
    '@/services/connect': { connect: {
      async offerCall(...args) { requests.push(['offer', ...args]); await offerDelay; return { callId: 'c1' } },
      async callAction(...args) { requests.push(['action', ...args]); await actionDelay },
      async voiceMedia(id, callId, callbacks) { requests.push(['audio']); callbacks.onState('ready'); return media },
      async videoMedia(id, callId, preparation, canvas, callbacks) {
        requests.push(['video']); videoCallbacks.push(callbacks)
        if (videoStartError) throw videoStartError
        callbacks.onState('ready'); return video
      },
      async connection() { return {} }, async calls() { return [{ callId: 'c1', state: 'ringing' }] },
    } },
    '@/config/runtime': { featureEnabled: () => false },
    '@/services/errors': { friendlyError: error => error.message },
    '@/services/normalizers': { isCallActive: () => true },
    '@/services/video-media': { VideoMediaSession: { async prepare() { requests.push(['camera']); if (rejectCamera) throw new Error('Câmera negada'); return { stream: { getTracks: () => [track] } } } } },
  }
  for (const item of ['@/layouts/AppShell.vue', '@/components/PageHeader.vue', '@/components/PanelCard.vue', '@/components/AppIcon.vue', '@/components/EmptyState.vue']) dependencies[item] = {}
  const api = load(source + '\nmodule.exports = { makeTestCall, action, reconnectVideo, instances, number, callCapabilities, remoteCanvas, mediaState, mediaCallId, selected, feedback, videoState, mediaError, busy };', {}, dependencies)
  api.instances.value = [{ id: 'i1', capabilities: { calls: true, voice: true } }]
  api.number.value = '5511999999999'
  api.remoteCanvas.value = {}
  api.callCapabilities.value = videoSupported ? { audio: true, video: true, videoCodec: 'h264' } : null
  return { api, requests, track, media, video, videoCallbacks }
}

test('camera denial prevents both video offer and acceptance requests', async () => {
  const h = viewHarness({ rejectCamera: true })
  await h.api.makeTestCall(true)
  await h.api.action({ callId: 'c1', isVideo: true }, 'accept')
  assert.deepEqual(h.requests, [['camera'], ['camera']])
})

test('voice offering and acceptance retain existing behavior with no video capabilities or camera', async () => {
  const h = viewHarness({ videoSupported: false, rejectCamera: true })
  await h.api.makeTestCall(false)
  await h.api.action({ callId: 'c1', isVideo: false }, 'accept')
  assert.equal(h.requests.some(([type]) => type === 'camera' || type === 'video'), false)
  assert.equal(h.requests[0][0], 'offer')
  assert.equal(h.requests[0][4], false)
  assert.ok(h.requests.some(([type]) => type === 'action'))
})

test('video permission precedes API offer and bidirectional video session attaches alongside audio', async () => {
  const h = viewHarness()
  await h.api.makeTestCall(true)
  assert.equal(h.requests[0][0], 'camera')
  assert.equal(h.requests[1][0], 'offer')
  assert.equal(h.requests[1][4], true)
  assert.ok(h.requests.some(([type]) => type === 'audio'))
  assert.ok(h.requests.some(([type]) => type === 'video'))
})

test('rejected video authorization exposes an error and releases busy while preserving the voice call', async () => {
  const message = 'Não foi possível autorizar o vídeo desta chamada.'
  const h = viewHarness({ videoStartError: new Error(message) })
  await h.api.makeTestCall(true)
  assert.equal(h.api.busy.value, false)
  assert.equal(h.api.videoState.value, 'error')
  assert.equal(h.api.mediaError.value, message)
  assert.equal(h.track.stops, 1)
  assert.equal(h.api.mediaState.value, 'ready')
  assert.equal(h.api.mediaCallId.value, 'c1')
  assert.equal(h.media.stops, 0)
  assert.equal(h.requests.filter(([type]) => type === 'offer').length, 1)
  assert.equal(h.requests.some(([type]) => type === 'action'), false)
})

test('video error and reconnect preserve the exact voice session, microphone state and audio status', async () => {
  const h = viewHarness()
  await h.api.makeTestCall(true)
  h.media.setMicMuted(true)
  h.videoCallbacks[0].onError('Perfil remoto não suportado')
  h.videoCallbacks[0].onState('error')
  assert.equal(h.api.mediaState.value, 'ready')
  assert.equal(h.media.stops, 0)
  await h.api.reconnectVideo()
  assert.equal(h.requests.filter(([type]) => type === 'audio').length, 1)
  assert.equal(h.requests.filter(([type]) => type === 'video').length, 2)
  assert.equal(h.media.stops, 0)
  assert.equal(h.media.muted, true)
  assert.equal(h.api.mediaState.value, 'ready')
  assert.equal(h.video.stops, 1)
})

test('switching instance during offer or acceptance discards late response and releases prepared camera', async () => {
  for (const operation of ['offer', 'accept']) {
    let release
    const pending = new Promise(resolve => { release = resolve })
    const h = viewHarness(operation === 'offer' ? { offerDelay: pending } : { actionDelay: pending })
    const result = operation === 'offer' ? h.api.makeTestCall(true) : h.api.action({ callId: 'c1', isVideo: true }, 'accept')
    await drain()
    h.api.selected.value = 'other-instance'
    release(); await result
    assert.equal(h.requests.some(([type]) => type === 'audio' || type === 'video'), false)
    assert.equal(h.api.feedback.value, '')
    assert.equal(h.track.stops, 1)
  }
})
