import { decodeVideoFrame, encodeVideoFrame, h264DecoderCodec, VIDEO_MAX_FRAME_BYTES } from './video-frame'
import type { VoiceMediaCredentials } from './voice-media'

export type VideoMediaSettings = {
  codec?: 'h264'; format?: 'annexb'; mediaPath?: string
  maxFrameBytes?: number; maxFps?: number; width?: number; height?: number; bitrate?: number
}
export type CallCapabilities = {
  audio: boolean; video: boolean; engine: string; videoCodec?: 'h264'; videoMedia?: VideoMediaSettings
}
export type VideoMediaState = 'idle' | 'requesting_camera' | 'connecting' | 'ready' | 'closed' | 'error'
export type VideoMediaCallbacks = {
  onSession?: (session: VideoMediaSession) => void
  onState?: (state: VideoMediaState) => void
  onError?: (message: string) => void
  onRemoteFrame?: () => void
}
export type VideoMediaPreparation = {
  stream: MediaStream; encoderConfig: VideoEncoderConfig; decoderConfig: VideoDecoderConfig
  settings: Required<Pick<VideoMediaSettings, 'width' | 'height' | 'maxFps' | 'bitrate' | 'maxFrameBytes'>>
}

function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value!))) : fallback
}

export class VideoMediaSession {
  private socket: WebSocket | null = null
  private encoder: VideoEncoder | null = null
  private decoder: VideoDecoder | null = null
  private captureVideo: HTMLVideoElement | null = null
  private captureCanvas: HTMLCanvasElement | null = null
  private captureTimer: number | undefined
  private connectTimer: number | undefined
  private requestController = new AbortController()
  private rejectConnection: ((error: Error) => void) | null = null
  private ready = false
  private closed = false
  private cameraEnabled = true
  private needsKeyFrame = true
  private decoderNeedsKeyFrame = true
  private decoderReconfiguring = false
  private decoderConfigurationGeneration = 0
  private droppedDuringReconfigure = false
  private remoteDecoderConfig: VideoDecoderConfig
  private lastKeyFrameAt = 0
  private lastKeyFrameRequestAt = -Infinity
  private lastTimestamp = -1
  private pageHide = () => this.stop()

  constructor(
    private readonly credentials: VoiceMediaCredentials,
    private readonly preparation: VideoMediaPreparation,
    private readonly remoteCanvas: HTMLCanvasElement,
    private readonly callbacks: VideoMediaCallbacks = {},
  ) { this.remoteDecoderConfig = { ...preparation.decoderConfig } }

  static async prepare(settings: VideoMediaSettings = {}): Promise<VideoMediaPreparation> {
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('A câmera exige HTTPS e um navegador com acesso à mídia.')
    }
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined') {
      throw new Error('Este navegador não oferece vídeo H.264 em tempo real. Use um navegador compatível com WebCodecs.')
    }
    const resolved = {
      width: bounded(settings.width, 640, 160, 1920) & ~1,
      height: bounded(settings.height, 480, 120, 1080) & ~1,
      bitrate: bounded(settings.bitrate, 800_000, 100_000, 8_000_000),
      maxFps: bounded(settings.maxFps, 30, 1, 30),
      maxFrameBytes: bounded(settings.maxFrameBytes, VIDEO_MAX_FRAME_BYTES, 1024, VIDEO_MAX_FRAME_BYTES),
    }
    const encoderConfig: VideoEncoderConfig = {
      codec: 'avc1.42E01F', width: resolved.width, height: resolved.height,
      bitrate: resolved.bitrate, framerate: resolved.maxFps, latencyMode: 'realtime', avc: { format: 'annexb' },
    }
    const decoderConfig: VideoDecoderConfig = { codec: encoderConfig.codec, optimizeForLatency: true }
    const [encoder, decoder] = await Promise.all([
      VideoEncoder.isConfigSupported(encoderConfig), VideoDecoder.isConfigSupported(decoderConfig),
    ])
    if (!encoder.supported || !decoder.supported) {
      throw new Error('Este navegador não consegue enviar e receber H.264. O atendimento por vídeo não foi iniciado.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: resolved.width }, height: { ideal: resolved.height }, frameRate: { ideal: resolved.maxFps, max: resolved.maxFps } },
      audio: false,
    })
    if (!stream.getVideoTracks().some(track => track.readyState === 'live')) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('A câmera não disponibilizou uma faixa de vídeo.')
    }
    return { stream, encoderConfig, decoderConfig, settings: resolved }
  }

  async start() {
    if (this.closed) throw new Error('A sessão de vídeo já foi encerrada.')
    window.addEventListener('pagehide', this.pageHide)
    this.callbacks.onState?.('connecting')
    try {
      this.configureCodecs()
      const ticket = await this.requestTicket()
      if (this.closed) throw new Error('A sessão de vídeo foi encerrada.')
      this.credentials.token = ''
      await this.connectSocket(ticket)
      if (this.closed) throw new Error('A sessão de vídeo foi encerrada.')
      this.captureVideo = document.createElement('video')
      this.captureVideo.muted = true
      this.captureVideo.playsInline = true
      this.captureVideo.srcObject = this.preparation.stream
      await this.captureVideo.play()
      if (this.closed) return
      this.captureCanvas = document.createElement('canvas')
      this.captureCanvas.width = this.preparation.settings.width
      this.captureCanvas.height = this.preparation.settings.height
      for (const track of this.preparation.stream.getVideoTracks()) track.addEventListener('ended', this.pageHide, { once: true })
      this.capture()
    } catch (error) {
      if (!this.closed) this.fail(error)
      throw error
    }
  }

  private configureCodecs() {
    this.encoder = new VideoEncoder({
      output: chunk => {
        if (!this.ready || this.closed || this.socket?.readyState !== WebSocket.OPEN || !this.cameraEnabled) return
        if (this.socket.bufferedAmount > 512 * 1024 || chunk.byteLength > this.preparation.settings.maxFrameBytes) {
          this.needsKeyFrame = true
          return
        }
        if (this.needsKeyFrame && chunk.type !== 'key') return
        if (chunk.type === 'key') this.needsKeyFrame = false
        try {
          const data = new Uint8Array(chunk.byteLength)
          chunk.copyTo(data)
          this.socket.send(encodeVideoFrame({ data, timestampUs: chunk.timestamp, keyFrame: chunk.type === 'key' }, this.preparation.settings.maxFrameBytes))
        } catch (error) { this.fail(error) }
      },
      error: error => this.fail(error),
    })
    this.encoder.configure(this.preparation.encoderConfig)
    this.decoder = new VideoDecoder({
      output: frame => {
        try {
          if (this.closed) return
          const context = this.remoteCanvas.getContext('2d')
          if (!context) return
          if (this.remoteCanvas.width !== frame.displayWidth) this.remoteCanvas.width = frame.displayWidth
          if (this.remoteCanvas.height !== frame.displayHeight) this.remoteCanvas.height = frame.displayHeight
          context.drawImage(frame, 0, 0)
          this.callbacks.onRemoteFrame?.()
        } finally { frame.close() }
      },
      error: () => { if (!this.closed) this.recoverDecoder() },
    })
    this.decoder.configure(this.remoteDecoderConfig)
  }

  private capture() {
    if (this.closed) return
    this.captureTimer = window.setTimeout(() => this.capture(), 1000 / this.preparation.settings.maxFps)
    if (!this.ready || !this.cameraEnabled || !this.captureVideo || !this.captureCanvas || !this.encoder) return
    if (this.captureVideo.readyState < 2 || this.encoder.state !== 'configured' || this.encoder.encodeQueueSize > 2) return
    if (!this.socket || this.socket.bufferedAmount > 512 * 1024) { this.needsKeyFrame = true; return }
    const context = this.captureCanvas.getContext('2d')
    if (!context) return
    let frame: VideoFrame | null = null
    try {
      context.drawImage(this.captureVideo, 0, 0, this.captureCanvas.width, this.captureCanvas.height)
      const timestamp = Math.max(this.lastTimestamp + 1, Math.trunc(performance.now() * 1000))
      this.lastTimestamp = timestamp
      const keyFrame = this.needsKeyFrame || timestamp - this.lastKeyFrameAt >= 2_000_000
      if (keyFrame) this.lastKeyFrameAt = timestamp
      frame = new VideoFrame(this.captureCanvas, { timestamp })
      this.encoder.encode(frame, { keyFrame })
    } catch (error) { this.fail(error) } finally { frame?.close() }
  }

  private async requestTicket() {
    if (!this.credentials.token) throw new Error('A credencial para autorizar o vídeo está indisponível.')
    const timeout = window.setTimeout(() => this.requestController.abort(), 15_000)
    try {
      const url = `${this.credentials.apiBaseUrl.replace(/\/+$/, '')}/call/videoMediaTicket/${encodeURIComponent(this.credentials.instanceName)}`
      const response = await fetch(url, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: this.requestController.signal,
        headers: { 'content-type': 'application/json', apikey: this.credentials.token },
        body: JSON.stringify({ callId: this.credentials.callId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ticket) throw new Error('Não foi possível autorizar o vídeo desta chamada.')
      if (payload.codec !== 'h264' || payload.format !== 'annexb') throw new Error('O servidor não disponibilizou vídeo H.264 compatível.')
      if (payload.width !== this.preparation.settings.width || payload.height !== this.preparation.settings.height || payload.maxFps !== this.preparation.settings.maxFps || payload.bitrate !== this.preparation.settings.bitrate) {
        throw new Error('A configuração de vídeo mudou. Atualize a página e tente novamente.')
      }
      this.preparation.settings.maxFrameBytes = Math.min(this.preparation.settings.maxFrameBytes, bounded(payload.maxFrameBytes, VIDEO_MAX_FRAME_BYTES, 1024, VIDEO_MAX_FRAME_BYTES))
      return String(payload.ticket)
    } finally { window.clearTimeout(timeout) }
  }

  private connectSocket(ticket: string) {
    const url = new URL(this.credentials.apiBaseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/video/media'
    url.search = ''
    url.hash = ''
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      this.socket = socket
      socket.binaryType = 'arraybuffer'
      this.rejectConnection = reject
      this.connectTimer = window.setTimeout(() => this.fail(new Error('O vídeo não respondeu a tempo.')), 15_000)
      socket.onopen = () => socket.send(JSON.stringify({ ticket }))
      socket.onmessage = event => {
        if (this.closed) return
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data)
            if (message.type === 'ready' && message.codec === 'h264' && message.format === 'annexb') {
              this.ready = true
              window.clearTimeout(this.connectTimer)
              this.rejectConnection = null
              this.callbacks.onState?.('ready')
              this.requestKeyFrame()
              resolve()
            } else if (message.type === 'request_keyframe') this.needsKeyFrame = true
            else if (message.type === 'error') this.fail(new Error('O servidor encerrou a transmissão de vídeo.'))
          } catch { this.fail(new Error('Resposta de vídeo inválida.')) }
          return
        }
        if (!this.ready || !(event.data instanceof ArrayBuffer)) return
        void this.receiveFrame(event.data).catch(() => { if (!this.closed) this.recoverDecoder() })
      }
      socket.onerror = () => this.fail(new Error('Não foi possível conectar o vídeo da chamada.'))
      socket.onclose = () => {
        if (!this.closed) this.fail(new Error('A transmissão de vídeo foi desconectada.'))
      }
    })
  }

  private async receiveFrame(packet: ArrayBuffer) {
    if (this.decoderReconfiguring) {
      // Retain at most one bounded access unit while querying codec support.
      this.droppedDuringReconfigure = true
      return
    }
    const frame = decodeVideoFrame(packet, this.preparation.settings.maxFrameBytes)
    const remoteCodec = h264DecoderCodec(frame.data)
    if (remoteCodec && remoteCodec !== this.remoteDecoderConfig.codec) {
      this.decoderNeedsKeyFrame = true
      this.decoderReconfiguring = true
      this.droppedDuringReconfigure = false
      const generation = ++this.decoderConfigurationGeneration
      const config: VideoDecoderConfig = { codec: remoteCodec, optimizeForLatency: true }
      try {
        const support = await VideoDecoder.isConfigSupported(config)
        if (this.closed || generation !== this.decoderConfigurationGeneration) return
        if (!support.supported) {
          this.fail(new Error('O navegador não suporta o perfil H.264 do outro participante. O áudio continua disponível.'))
          return
        }
        if (!this.decoder || this.decoder.state === 'closed') return
        this.decoder.reset()
        this.decoder.configure(config)
        this.remoteDecoderConfig = config
        if (this.droppedDuringReconfigure) { this.requestKeyFrame(); return }
      } catch {
        if (!this.closed) this.fail(new Error('Não foi possível configurar o vídeo do outro participante. O áudio continua disponível.'))
        return
      } finally {
        if (generation === this.decoderConfigurationGeneration) this.decoderReconfiguring = false
      }
    }
    if (this.closed) return
    if (!this.decoder || this.decoder.state !== 'configured') { this.recoverDecoder(); return }
    if (this.decoder.decodeQueueSize > 4) { this.recoverDecoder(); return }
    if (this.decoderNeedsKeyFrame && !frame.keyFrame) { this.requestKeyFrame(); return }
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: frame.keyFrame ? 'key' : 'delta', timestamp: frame.timestampUs, data: frame.data }))
      if (frame.keyFrame) this.decoderNeedsKeyFrame = false
    } catch { this.recoverDecoder() }
  }

  private recoverDecoder() {
    this.decoderNeedsKeyFrame = true
    if (this.decoder?.state === 'closed') {
      this.fail(new Error('Não foi possível decodificar o vídeo remoto. Reconecte a mídia da chamada.'))
      return
    }
    try { this.decoder?.reset(); this.decoder?.configure(this.remoteDecoderConfig) } catch { /* Wait for a valid keyframe. */ }
    this.requestKeyFrame()
  }

  private requestKeyFrame() {
    if (!this.ready || this.closed || this.socket?.readyState !== WebSocket.OPEN || performance.now() - this.lastKeyFrameRequestAt < 500) return
    this.lastKeyFrameRequestAt = performance.now()
    this.socket.send(JSON.stringify({ type: 'request_keyframe' }))
  }

  setCameraEnabled(enabled: boolean) {
    this.cameraEnabled = enabled
    for (const track of this.preparation.stream.getVideoTracks()) track.enabled = enabled
    if (enabled) this.needsKeyFrame = true
  }

  private fail(error: unknown) {
    if (this.closed) return
    this.callbacks.onError?.(error instanceof Error ? error.message : 'Falha no vídeo da chamada.')
    this.stop()
    this.callbacks.onState?.('error')
  }

  stop() {
    if (this.closed) return
    this.closed = true
    this.decoderConfigurationGeneration += 1
    this.ready = false
    this.credentials.token = ''
    this.requestController.abort()
    this.rejectConnection?.(new Error('A sessão de vídeo foi encerrada.'))
    this.rejectConnection = null
    window.clearTimeout(this.captureTimer)
    window.clearTimeout(this.connectTimer)
    window.removeEventListener('pagehide', this.pageHide)
    for (const track of this.preparation.stream.getTracks()) { track.removeEventListener('ended', this.pageHide); track.stop() }
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close()
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close()
    if (this.captureVideo) { this.captureVideo.pause(); this.captureVideo.srcObject = null }
    this.captureVideo = null
    this.captureCanvas = null
    if (this.socket) {
      this.socket.onclose = null
      this.socket.onerror = null
      this.socket.onmessage = null
      this.socket.onopen = null
      if (this.socket.readyState <= WebSocket.OPEN) this.socket.close(1000, 'Vídeo encerrado')
      this.socket = null
    }
    this.callbacks.onState?.('closed')
  }
}
