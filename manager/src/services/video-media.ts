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
  onRemoteRecovery?: () => void
  onRemoteFrame?: () => void
}
export type VideoMediaPreparation = {
  stream: MediaStream; encoderConfig: VideoEncoderConfig; decoderConfig: VideoDecoderConfig
  settings: Required<Pick<VideoMediaSettings, 'width' | 'height' | 'maxFps' | 'bitrate' | 'maxFrameBytes'>>
}

const REMOTE_FRAME_TIMEOUT_MS = 2500
const RECONNECT_INITIAL_DELAY_MS = 500
const RECONNECT_MAX_DELAY_MS = 5000
const MAX_RECONNECT_ATTEMPTS = 8
const DECODER_RECOVERY_INITIAL_DELAY_MS = 100
const DECODER_RECOVERY_MAX_DELAY_MS = 1000

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
  private requestController: AbortController | null = null
  private rejectConnection: ((error: Error) => void) | null = null
  private reconnectTimer: number | undefined
  private reconnectAttempt = 0
  private reconnecting = false
  private readonly apiToken: string
  private ready = false
  private closed = false
  private cameraEnabled = true
  private needsKeyFrame = true
  private decoderNeedsKeyFrame = true
  private decoderReconfiguring = false
  private decoderConfigurationGeneration = 0
  private decoderRecoveryTimer: number | undefined
  private decoderRecoveryAttempt = 0
  private droppedDuringReconfigure = false
  private remoteDecoderConfig: VideoDecoderConfig
  private lastKeyFrameAt = 0
  private lastKeyFrameRequestAt = -Infinity
  private lastTimestamp = -1
  private lastRemoteTimestamp = -1
  private lastRemoteFrameAt = 0
  private remoteRecoveryTimer: number | undefined
  private processingFrame = false
  private pendingFrame: ArrayBuffer | null = null
  private pageHide = () => this.stop()

  constructor(
    private readonly credentials: VoiceMediaCredentials,
    private readonly preparation: VideoMediaPreparation,
    private readonly remoteCanvas: HTMLCanvasElement,
    private readonly callbacks: VideoMediaCallbacks = {},
  ) {
    this.remoteDecoderConfig = { ...preparation.decoderConfig }
    this.apiToken = credentials.token
  }

  static async prepare(settings: VideoMediaSettings = {}, signal?: AbortSignal): Promise<VideoMediaPreparation> {
    signal?.throwIfAborted()
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
    const constraints: MediaStreamConstraints = {
      video: { width: { ideal: resolved.width }, height: { ideal: resolved.height }, frameRate: { ideal: resolved.maxFps, max: resolved.maxFps } },
      audio: false,
    }
    let stream: MediaStream
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted()
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (error) {
        signal?.throwIfAborted()
        const name = (error as { name?: string })?.name
        const temporarilyUnavailable = name === 'NotReadableError' || name === 'TrackStartError'
        if (temporarilyUnavailable && attempt === 0) {
          // Give the driver one bounded opportunity to release a stopped capture.
          await new Promise(resolve => window.setTimeout(resolve, 200))
          continue
        }
        if (temporarilyUnavailable) {
          throw new Error('Não foi possível abrir a câmera. Aguarde um instante e tente atender com vídeo novamente.')
        }
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error('Permita o acesso à câmera no navegador para iniciar ou atender com vídeo.')
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          throw new Error('Nenhuma câmera disponível foi encontrada. Verifique a conexão da câmera.')
        }
        throw error
      }
    }
    // getUserMedia itself cannot be aborted; release a late result immediately.
    if (signal?.aborted) {
      stream.getTracks().forEach(track => track.stop())
      signal.throwIfAborted()
    }
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
    this.decoder = this.createDecoder(this.remoteDecoderConfig)
  }

  private createDecoder(config: VideoDecoderConfig) {
    let decoder!: VideoDecoder
    decoder = new VideoDecoder({
      output: frame => {
        try {
          if (this.closed || this.decoder !== decoder) return
          const context = this.remoteCanvas.getContext('2d')
          if (!context) return
          if (this.remoteCanvas.width !== frame.displayWidth) this.remoteCanvas.width = frame.displayWidth
          if (this.remoteCanvas.height !== frame.displayHeight) this.remoteCanvas.height = frame.displayHeight
          context.drawImage(frame, 0, 0)
          this.lastRemoteFrameAt = performance.now()
          this.decoderRecoveryAttempt = 0
          this.callbacks.onRemoteFrame?.()
        } finally { frame.close() }
      },
      // WebCodecs closes a decoder after a codec error. Recreate only that
      // decoder instead of forcing the operator to reconnect an active call.
      error: () => { if (!this.closed && this.decoder === decoder) this.recoverDecoder(true) },
    })
    decoder.configure(config)
    return decoder
  }

  private replaceDecoder() {
    const previous = this.decoder
    this.decoder = null
    if (previous && previous.state !== 'closed') {
      try { previous.close() } catch { /* A failed decoder is already unusable. */ }
    }
    try {
      this.decoder = this.createDecoder(this.remoteDecoderConfig)
      return true
    } catch {
      this.scheduleDecoderRecovery()
      return false
    }
  }

  private resetDecoder() {
    const decoder = this.decoder
    if (!decoder || decoder.state === 'closed') return this.replaceDecoder()
    try {
      decoder.reset()
      decoder.configure(this.remoteDecoderConfig)
      return true
    } catch {
      return this.replaceDecoder()
    }
  }

  private scheduleDecoderRecovery() {
    if (this.closed || this.decoderRecoveryTimer !== undefined) return
    const delay = Math.min(
      DECODER_RECOVERY_MAX_DELAY_MS,
      DECODER_RECOVERY_INITIAL_DELAY_MS * (2 ** this.decoderRecoveryAttempt),
    )
    this.decoderRecoveryAttempt += 1
    this.decoderRecoveryTimer = window.setTimeout(() => {
      this.decoderRecoveryTimer = undefined
      this.recoverDecoder(true)
    }, delay)
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
    if (!this.apiToken) throw new Error('A credencial para autorizar o vídeo está indisponível.')
    const controller = new AbortController()
    this.requestController = controller
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    try {
      const url = `${this.credentials.apiBaseUrl.replace(/\/+$/, '')}/call/videoMediaTicket/${encodeURIComponent(this.credentials.instanceName)}`
      const response = await fetch(url, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json', apikey: this.apiToken },
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
    } finally {
      window.clearTimeout(timeout)
      if (this.requestController === controller) this.requestController = null
    }
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
      let settled = false
      const settleError = (error: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(this.connectTimer)
        if (this.rejectConnection === reject) this.rejectConnection = null
        reject(error)
      }
      this.connectTimer = window.setTimeout(() => {
        if (this.closed || this.socket !== socket) return
        if (!this.reconnecting) {
          this.fail(new Error('O vídeo não respondeu a tempo.'))
          return
        }
        settleError(new Error('O vídeo não respondeu a tempo.'))
        socket.close()
        this.scheduleReconnect()
      }, 15_000)
      socket.onopen = () => socket.send(JSON.stringify({ ticket }))
      socket.onmessage = event => {
        if (this.closed || this.socket !== socket) return
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data)
            if (message.type === 'ready' && message.codec === 'h264' && message.format === 'annexb') {
              settled = true
              this.ready = true
              window.clearTimeout(this.connectTimer)
              if (this.rejectConnection === reject) this.rejectConnection = null
              this.reconnectAttempt = 0
              this.reconnecting = false
              this.needsKeyFrame = true
              this.decoderNeedsKeyFrame = true
              this.lastRemoteTimestamp = -1
              this.callbacks.onState?.('ready')
              this.startRemoteRecovery()
              this.requestKeyFrame()
              resolve()
            } else if (message.type === 'request_keyframe') this.needsKeyFrame = true
            else if (message.type === 'error') this.fail(new Error('O servidor encerrou a transmissão de vídeo.'))
          } catch { this.fail(new Error('Resposta de vídeo inválida.')) }
          return
        }
        if (!this.ready || !(event.data instanceof ArrayBuffer)) return
        this.enqueueFrame(event.data)
      }
      socket.onerror = () => {
        if (this.closed || this.socket !== socket) return
        const wasReady = this.ready
        this.ready = false
        if (!wasReady && !this.reconnecting) {
          this.fail(new Error('Não foi possível conectar o vídeo da chamada.'))
          return
        }
        settleError(new Error('Não foi possível conectar o vídeo da chamada.'))
        this.handleSocketLoss(socket)
      }
      socket.onclose = (event?: CloseEvent) => {
        if (this.socket !== socket) return
        const wasReady = this.ready
        this.ready = false
        this.socket = null
        window.clearTimeout(this.connectTimer)
        if (this.closed) return
        const terminal = event?.code === 1000 && /ended/i.test(event.reason || '')
        if (terminal) {
          this.stop()
          return
        }
        if (!wasReady && !this.reconnecting) {
          this.fail(new Error('A transmissão de vídeo foi desconectada.'))
          return
        }
        settleError(new Error('A transmissão de vídeo foi desconectada.'))
        this.handleSocketLoss(socket)
      }
    })
  }

  private handleSocketLoss(_socket: WebSocket) {
    if (this.closed) return
    this.ready = false
    this.needsKeyFrame = true
    this.decoderNeedsKeyFrame = true
    this.lastRemoteTimestamp = -1
    this.callbacks.onState?.('connecting')
    this.scheduleReconnect()
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== undefined || this.reconnecting) return
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.fail(new Error('O vídeo não conseguiu se reconectar. O áudio da chamada continua disponível.'))
      return
    }
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_INITIAL_DELAY_MS * (2 ** this.reconnectAttempt))
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined
      void this.reconnectVideoSocket()
    }, delay)
  }

  private async reconnectVideoSocket() {
    if (this.closed || this.reconnecting) return
    this.reconnecting = true
    this.callbacks.onState?.('connecting')
    try {
      const ticket = await this.requestTicket()
      if (this.closed) return
      await this.connectSocket(ticket)
    } catch {
      this.reconnecting = false
      if (!this.closed) this.scheduleReconnect()
    }
  }

  private enqueueFrame(packet: ArrayBuffer) {
    if (this.closed) return
    if (this.processingFrame) {
      // Keep only the newest access unit while codec support or decode output
      // is pending. A bounded queue is essential for a light, low-latency UI.
      this.pendingFrame = packet
      return
    }
    this.processingFrame = true
    void this.receiveFrame(packet)
      .catch(() => { if (!this.closed) this.recoverDecoder() })
      .finally(() => {
        this.processingFrame = false
        const next = this.pendingFrame
        this.pendingFrame = null
        if (next && !this.closed) this.enqueueFrame(next)
      })
  }

  private startRemoteRecovery() {
    if (this.remoteRecoveryTimer !== undefined) window.clearTimeout(this.remoteRecoveryTimer)
    this.lastRemoteFrameAt = performance.now()
    const check = () => {
      if (this.closed || !this.ready) return
      const now = performance.now()
      if (now - this.lastRemoteFrameAt >= REMOTE_FRAME_TIMEOUT_MS) {
        this.decoderNeedsKeyFrame = true
        this.requestKeyFrame()
        this.lastRemoteFrameAt = now
      }
      this.remoteRecoveryTimer = window.setTimeout(check, 1000)
    }
    this.remoteRecoveryTimer = window.setTimeout(check, 1000)
  }

  private async receiveFrame(packet: ArrayBuffer) {
    if (this.decoderReconfiguring) {
      // Retain at most one bounded access unit while querying codec support.
      this.droppedDuringReconfigure = true
      return
    }
    const frame = decodeVideoFrame(packet, this.preparation.settings.maxFrameBytes)
    if (frame.timestampUs <= this.lastRemoteTimestamp) {
      if (!frame.keyFrame) {
        this.decoderNeedsKeyFrame = true
        this.requestKeyFrame()
        return
      }
      // Keep decoding recoverable when the sender restarts its clock. The
      // server also gates this transition on an IDR, so dependent frames are
      // never fed into a fresh decoder timeline.
      if (!this.resetDecoder()) return
      this.decoderNeedsKeyFrame = true
      this.lastRemoteTimestamp = -1
    }
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
        this.remoteDecoderConfig = config
        if (!this.resetDecoder()) return
        if (this.droppedDuringReconfigure) { this.requestKeyFrame(); return }
      } catch {
        if (!this.closed) this.fail(new Error('Não foi possível configurar o vídeo do outro participante. O áudio continua disponível.'))
        return
      } finally {
        if (generation === this.decoderConfigurationGeneration) this.decoderReconfiguring = false
      }
    }
    if (this.closed) return
    if (!this.decoder || this.decoder.state !== 'configured') { this.recoverDecoder(true); return }
    if (this.decoder.decodeQueueSize > 4) {
      this.decoderNeedsKeyFrame = true
      this.requestKeyFrame()
      return
    }
    if (this.decoderNeedsKeyFrame && !frame.keyFrame) { this.requestKeyFrame(); return }
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: frame.keyFrame ? 'key' : 'delta', timestamp: frame.timestampUs, data: frame.data }))
      this.lastRemoteTimestamp = frame.timestampUs
      if (frame.keyFrame) this.decoderNeedsKeyFrame = false
    } catch { this.recoverDecoder() }
  }

  private recoverDecoder(recreate = false) {
    if (this.closed || this.decoderRecoveryTimer !== undefined) return
    this.decoderNeedsKeyFrame = true
    this.lastRemoteTimestamp = -1
    this.lastRemoteFrameAt = performance.now()
    this.callbacks.onRemoteRecovery?.()
    const recovered = recreate || this.decoder?.state === 'closed'
      ? this.replaceDecoder()
      : this.resetDecoder()
    if (!recovered) return
    this.decoderRecoveryAttempt = 0
    // Recovery needs the next complete IDR immediately; do not wait for the
    // normal PLI throttle after a decoder failure.
    this.lastKeyFrameRequestAt = -Infinity
    this.requestKeyFrame()
  }

  private requestKeyFrame() {
    if (!this.ready || this.closed || this.socket?.readyState !== WebSocket.OPEN || performance.now() - this.lastKeyFrameRequestAt < 500) return false
    this.lastKeyFrameRequestAt = performance.now()
    this.socket.send(JSON.stringify({ type: 'request_keyframe' }))
    return true
  }

  requestRemoteKeyFrame() {
    if (!this.ready || this.closed) return false
    this.decoderNeedsKeyFrame = true
    return this.requestKeyFrame()
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
    this.requestController?.abort()
    this.requestController = null
    this.rejectConnection?.(new Error('A sessão de vídeo foi encerrada.'))
    this.rejectConnection = null
    window.clearTimeout(this.captureTimer)
    window.clearTimeout(this.connectTimer)
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    window.clearTimeout(this.decoderRecoveryTimer)
    this.decoderRecoveryTimer = undefined
    this.reconnecting = false
    if (this.remoteRecoveryTimer !== undefined) window.clearTimeout(this.remoteRecoveryTimer)
    this.remoteRecoveryTimer = undefined
    this.pendingFrame = null
    this.lastRemoteTimestamp = -1
    this.lastRemoteFrameAt = 0
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
