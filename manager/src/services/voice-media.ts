export type VoiceMediaState = 'idle' | 'requesting_microphone' | 'connecting' | 'ready' | 'closed' | 'error'

export type VoiceMediaCallbacks = {
  onState?: (state: VoiceMediaState) => void
  onError?: (message: string) => void
}

export type VoiceMediaCredentials = {
  apiBaseUrl: string
  instanceName: string
  callId: string
  token: string
}

type VoiceMediaTicketResponse = {
  ticket?: string
  mediaPath?: string
}

function downsample(input: Float32Array, inputRate: number, outputRate = 16000) {
  if (inputRate === outputRate) return new Float32Array(input)
  if (outputRate > inputRate) return new Float32Array(input)

  const ratio = inputRate / outputRate
  const resultLength = Math.max(1, Math.round(input.length / ratio))
  const result = new Float32Array(resultLength)
  let outputIndex = 0
  let inputIndex = 0

  while (outputIndex < resultLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio))
    let sum = 0
    let count = 0
    for (let i = inputIndex; i < nextInputIndex; i += 1) {
      sum += input[i]
      count += 1
    }
    result[outputIndex] = count ? sum / count : input[Math.min(inputIndex, input.length - 1)] || 0
    outputIndex += 1
    inputIndex = nextInputIndex
  }

  return result
}

function mediaWebsocketUrl(apiBaseUrl: string, mediaPath: string) {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = mediaPath || '/voice/media'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export class VoiceMediaSession {
  private socket: WebSocket | null = null
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private silentGain: GainNode | null = null
  private playbackCursor = 0
  private ready = false
  private closed = false
  private micMuted = false

  constructor(
    private readonly credentials: VoiceMediaCredentials,
    private readonly callbacks: VoiceMediaCallbacks = {},
  ) {}

  private setState(state: VoiceMediaState) {
    this.callbacks.onState?.(state)
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Falha no áudio da chamada.')
    this.callbacks.onError?.(message)
    this.setState('error')
  }

  async start() {
    if (this.closed) throw new Error('A sessão de áudio já foi encerrada.')
    if (!this.credentials.token) throw new Error('A credencial da instância não está disponível para solicitar o áudio da chamada.')
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não oferece acesso ao microfone.')

    this.setState('requesting_microphone')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      })

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) throw new Error('Áudio em tempo real não é suportado neste navegador.')
      this.audioContext = new AudioContextCtor()
      await this.audioContext.resume()
      this.attachMicrophone()

      const mediaTicket = await this.requestMediaTicket()
      this.credentials.token = ''
      await this.connectSocket(mediaTicket.mediaUrl, mediaTicket.ticket)
    } catch (error) {
      this.fail(error)
      this.stop()
      throw error
    }
  }

  setMicMuted(muted: boolean) {
    this.micMuted = muted
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !muted
  }

  isReady() {
    return this.ready
  }

  private async requestMediaTicket() {
    const baseUrl = this.credentials.apiBaseUrl.replace(/\/+$/, '')
    const url = new URL(`${baseUrl}/call/mediaTicket/${encodeURIComponent(this.credentials.instanceName)}`)
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        apikey: this.credentials.token,
      },
      body: JSON.stringify({ callId: this.credentials.callId }),
    })

    const text = await response.text()
    let payload: VoiceMediaTicketResponse & { message?: string; error?: string } = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = {}
    }

    if (!response.ok) {
      throw new Error(String(payload.message || payload.error || response.statusText || 'Não foi possível autorizar o áudio da chamada.'))
    }

    const ticket = String(payload.ticket || '')
    if (!ticket) throw new Error('A autorização temporária do áudio da chamada não foi emitida.')

    return {
      ticket,
      mediaUrl: mediaWebsocketUrl(this.credentials.apiBaseUrl, String(payload.mediaPath || '/voice/media')),
    }
  }

  private attachMicrophone() {
    if (!this.audioContext || !this.stream) return
    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.processor = this.audioContext.createScriptProcessor(2048, 1, 1)
    this.silentGain = this.audioContext.createGain()
    this.silentGain.gain.value = 0

    this.processor.onaudioprocess = (event) => {
      if (!this.ready || this.micMuted || this.socket?.readyState !== WebSocket.OPEN || !this.audioContext) return
      const input = event.inputBuffer.getChannelData(0)
      const pcm = downsample(input, this.audioContext.sampleRate, 16000)
      if (pcm.byteLength) this.socket.send(pcm.buffer)
    }

    this.source.connect(this.processor)
    this.processor.connect(this.silentGain)
    this.silentGain.connect(this.audioContext.destination)
  }

  private connectSocket(mediaUrl: string, ticket: string) {
    return new Promise<void>((resolve, reject) => {
      this.setState('connecting')
      const socket = new WebSocket(mediaUrl)
      this.socket = socket
      socket.binaryType = 'arraybuffer'

      let settled = false
      const finishReject = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      socket.onopen = () => {
        socket.send(JSON.stringify({ ticket }))
      }

      socket.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data)
            if (message?.type === 'ready') {
              this.ready = true
              this.setState('ready')
              if (!settled) {
                settled = true
                resolve()
              }
              return
            }
            if (message?.type === 'error') this.callbacks.onError?.(String(message.message || 'Falha no áudio da chamada.'))
          } catch {
            // Mensagens de controle desconhecidas são ignoradas.
          }
          return
        }

        try {
          const buffer = event.data instanceof ArrayBuffer ? event.data : await (event.data as Blob).arrayBuffer()
          this.playIncomingPcm(buffer)
        } catch (error) {
          this.callbacks.onError?.(error instanceof Error ? error.message : String(error))
        }
      }

      socket.onerror = () => finishReject(new Error('Não foi possível abrir o áudio em tempo real da chamada.'))
      socket.onclose = (event) => {
        this.ready = false
        if (!this.closed) {
          const reason = event.reason ? `: ${event.reason}` : ''
          if (!settled) finishReject(new Error(`Áudio da chamada encerrado${reason}`))
          else this.setState('closed')
        }
      }
    })
  }

  private playIncomingPcm(buffer: ArrayBuffer) {
    if (!this.audioContext || buffer.byteLength === 0 || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return
    const samples = new Float32Array(buffer.slice(0))
    if (!samples.length) return

    const audioBuffer = this.audioContext.createBuffer(1, samples.length, 16000)
    audioBuffer.copyToChannel(samples, 0)
    const source = this.audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.audioContext.destination)

    const now = this.audioContext.currentTime
    this.playbackCursor = Math.max(this.playbackCursor, now + 0.04)
    source.start(this.playbackCursor)
    this.playbackCursor += audioBuffer.duration
  }

  stop() {
    if (this.closed) return
    this.closed = true
    this.ready = false
    this.credentials.token = ''

    if (this.processor) {
      this.processor.onaudioprocess = null
      try { this.processor.disconnect() } catch {}
    }
    try { this.source?.disconnect() } catch {}
    try { this.silentGain?.disconnect() } catch {}
    for (const track of this.stream?.getTracks() || []) track.stop()

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      try { this.socket.close(1000, 'Teste finalizado') } catch {}
    }
    this.socket = null
    this.stream = null
    this.source = null
    this.processor = null
    this.silentGain = null

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => undefined)
    }
    this.audioContext = null
    this.setState('closed')
  }
}
