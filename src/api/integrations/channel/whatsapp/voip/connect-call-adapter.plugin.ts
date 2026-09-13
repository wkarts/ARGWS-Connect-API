import { voipPlugin } from '@innovatorssoft/voip';
import { defineWaClientPlugin, type WaClientPluginContext } from '@innovatorssoft/zapo-js';

import { connectVoipPlugin, type ConnectVoipPluginOptions } from './connect-voip.plugin';

type Owner = 'voice' | 'video';
type Node = Parameters<WaClientPluginContext['deps']['lowLevelCoordinator']['sendNode']>[0];
type Coordinator = ReturnType<ReturnType<typeof connectVoipPlugin>['setup']>;
type Factory = (options: ConnectVoipPluginOptions) => {
  setup: (ctx: WaClientPluginContext) => unknown;
};
type Reservation = { owner: Owner; existing: Set<string>; callId?: string };
const RETAIN_MS = 120_000;
const MAX_CORRELATIONS = 4096;

function boundedText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

function inner(node: Node): Node | undefined {
  return Array.isArray(node?.content)
    ? node.content.find((child) => child && typeof child.tag === 'string')
    : undefined;
}

function callIdOf(node: Node): string | undefined {
  return boundedText(node?.attrs?.['call-id']) || boundedText(inner(node)?.attrs?.['call-id']);
}

function isVideoOffer(node: Node): boolean {
  const offer = inner(node);
  return (
    node?.tag === 'call' &&
    offer?.tag === 'offer' &&
    Array.isArray(offer.content) &&
    offer.content.some((child) => child?.tag === 'video')
  );
}

/** A view with bound original methods: never overwrite the shared client/deps. */
function contextView<T extends object>(original: T, overrides: Partial<T>): T {
  return new Proxy({} as T, {
    get(_target, key) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) return Reflect.get(overrides, key);
      const value = Reflect.get(original, key, original);
      return typeof value === 'function' ? value.bind(original) : value;
    },
  });
}

/** Public-plugin composition. The native voice coordinator remains unchanged. */
export function createConnectCallAdapter(
  ctx: WaClientPluginContext,
  options: ConnectVoipPluginOptions = {},
  factories: { voice: Factory; video: Factory } = { voice: voipPlugin, video: connectVoipPlugin },
) {
  const videoEnabled = options.videoEnabled !== false;
  const maxConcurrentCalls = options.maxConcurrentCalls ?? 1;
  const videoCalls = new Map<string, number>();
  const voiceCalls = new Map<string, number>();
  const videoStanzas = new Map<string, { callId: string; expires: number }>();
  const reservations = new Set<Reservation>();
  const unregister = new Set<() => void>();
  const subscriptions: { event: string; listener: (...args: any[]) => void; wrapped: (...args: any[]) => void }[] = [];
  let voice: Coordinator;
  let video: Coordinator | undefined;
  let disposed = false;

  function prune() {
    const now = Date.now();
    for (const cache of [voiceCalls, videoCalls]) {
      for (const [id, expires] of cache) if (expires <= now) cache.delete(id);
      while (cache.size > MAX_CORRELATIONS) cache.delete(cache.keys().next().value);
    }
    for (const [id, record] of videoStanzas) if (record.expires <= now) videoStanzas.delete(id);
    while (videoStanzas.size > MAX_CORRELATIONS) videoStanzas.delete(videoStanzas.keys().next().value);
  }

  function remember(owner: Owner, callId: string) {
    const cache = owner === 'voice' ? voiceCalls : videoCalls;
    cache.delete(callId);
    cache.set(callId, Date.now() + RETAIN_MS);
    prune();
  }

  function ownerOf(callId: string): Owner {
    // A known voice call always wins, even if an invalid/colliding video frame
    // carries the same id. Engine assignment never follows mutable UI metadata.
    if (voice?.getCall(callId) || voiceCalls.has(callId)) return 'voice';
    return video?.getCall(callId) || videoCalls.has(callId) ? 'video' : 'voice';
  }

  function nodeOwner(node: Node): Owner {
    prune();
    const callId = callIdOf(node);
    if (callId && (voice?.getCall(callId) || voiceCalls.has(callId))) return 'voice';
    if (callId && (video?.getCall(callId) || videoCalls.has(callId))) return 'video';
    const stanzaId = boundedText(node?.attrs?.id);
    const tracked = stanzaId && videoStanzas.get(stanzaId);
    if (tracked) return ownerOf(tracked.callId);
    return videoEnabled && isVideoOffer(node) ? 'video' : 'voice';
  }

  function allCalls() {
    const calls = new Map(voice?.getCalls().map((call) => [call.callId, call]) || []);
    for (const call of video?.getCalls() || []) if (!calls.has(call.callId)) calls.set(call.callId, call);
    return [...calls.values()];
  }

  function occupied() {
    const calls = allCalls().filter((call) => !call.isEnded);
    return (
      calls.length +
      [...reservations].filter((item) => !item.callId || !calls.some((call) => call.callId === item.callId)).length
    );
  }

  function recordEvent(owner: Owner, args: unknown[]) {
    const payload = args[0] as any;
    const call = payload?.call || payload;
    const callId = boundedText(call?.callId);
    if (!callId) return;
    remember(owner, callId);
    if (call.isInitiator === true || call.direction === 'outgoing') {
      const reservation = [...reservations].find(
        (item) => item.owner === owner && !item.callId && !item.existing.has(callId),
      );
      if (reservation) reservation.callId = callId;
    }
  }

  function wrappedContext(owner: Owner): WaClientPluginContext {
    const overrides: { -readonly [K in keyof WaClientPluginContext]?: WaClientPluginContext[K] } = {
      emit(event, ...args) {
        recordEvent(owner, args);
        return ctx.emit(event, ...args);
      },
      registerIncomingHandler(registration) {
        const remove = ctx.registerIncomingHandler({
          ...registration,
          handler: async (node) => {
            if (disposed || nodeOwner(node) !== owner) return false;
            const newVideoOffer = owner === 'video' && isVideoOffer(node) && !video?.getCall(callIdOf(node));
            const atCapacity = newVideoOffer && occupied() >= maxConcurrentCalls;
            const callId = callIdOf(node);
            if (callId) remember(owner, callId);
            const reservation: Reservation =
              newVideoOffer && !atCapacity
                ? { owner: 'video', existing: new Set(allCalls().map((call) => call.callId)), callId }
                : undefined;
            if (reservation) reservations.add(reservation);
            try {
              const result = await registration.handler(node);
              // Native incoming audio keeps its own waiting-call behavior. Only
              // excess incoming video is refused through the public video API.
              if (atCapacity && callId && video?.getCall(callId)) await video.rejectCall(callId, 'busy' as any);
              return result;
            } finally {
              if (reservation) reservations.delete(reservation);
            }
          },
        });
        let removed = false;
        const disposeHandler = () => {
          if (removed) return;
          removed = true;
          unregister.delete(disposeHandler);
          remove();
        };
        unregister.add(disposeHandler);
        return disposeHandler;
      },
    };
    if (owner === 'video') {
      const original = ctx.deps.lowLevelCoordinator;
      overrides.deps = contextView(ctx.deps, {
        lowLevelCoordinator: contextView(original, {
          async sendNode(node) {
            const callId = callIdOf(node);
            const stanzaId = boundedText(node?.attrs?.id);
            if (callId) {
              remember('video', callId);
              if (stanzaId) videoStanzas.set(stanzaId, { callId, expires: Date.now() + RETAIN_MS });
              prune();
            }
            return original.sendNode(node);
          },
        }),
      });
    }
    return contextView(ctx, overrides);
  }

  try {
    voice = factories
      .voice({ maxConcurrentCalls, logLevel: options.logLevel })
      .setup(wrappedContext('voice')) as Coordinator;
    if (videoEnabled) video = factories.video(options).setup(wrappedContext('video')) as Coordinator;
  } catch (error) {
    voice?.dispose();
    for (const remove of unregister) remove();
    throw error;
  }

  function engineFor(callId: string): Coordinator {
    prune();
    return ownerOf(callId) === 'video' ? video : voice;
  }

  function unsubscribe(event: string, listener: (...args: any[]) => void, wrapped?: (...args: any[]) => void) {
    for (let index = subscriptions.length - 1; index >= 0; index--) {
      const entry = subscriptions[index];
      if (entry.event !== event || entry.listener !== listener) continue;
      if (wrapped && entry.wrapped !== wrapped) continue;
      voice.off(event as any, entry.wrapped);
      video?.off(event as any, entry.wrapped);
      subscriptions.splice(index, 1);
      break;
    }
  }

  const adapter = {
    engine: 'connect-video-adapter' as const,
    videoEnabled,
    async startCall(callOptions: Parameters<Coordinator['startCall']>[0]) {
      if (disposed) throw new Error('Call adapter is disposed');
      if (callOptions.isVideo && !video) throw new Error('Video calls are disabled');
      if (occupied() >= maxConcurrentCalls) throw new Error(`max concurrent calls reached (${maxConcurrentCalls})`);
      const owner: Owner = callOptions.isVideo ? 'video' : 'voice';
      const reservation: Reservation = { owner, existing: new Set(allCalls().map((call) => call.callId)) };
      reservations.add(reservation);
      try {
        const callId = await (owner === 'video' ? video : voice).startCall(callOptions);
        remember(owner, callId);
        return callId;
      } finally {
        reservations.delete(reservation);
      }
    },
    acceptCall: (callId: string) => engineFor(callId).acceptCall(callId),
    rejectCall: (callId: string, reason?: any) => engineFor(callId).rejectCall(callId, reason),
    endCall: (callId: string, reason?: any) => engineFor(callId).endCall(callId, reason),
    loadAudio: (callId: string, audioPath: string) => engineFor(callId).loadAudio(callId, audioPath),
    setMute: (callId: string, muted: boolean) => engineFor(callId).setMute(callId, muted),
    setExternalAudioMode: (callId: string, enabled: boolean) => engineFor(callId).setExternalAudioMode(callId, enabled),
    feedLiveAudio: (callId: string, pcm: Float32Array) => engineFor(callId).feedLiveAudio(callId, pcm),
    getLiveBufferMs: (callId: string) => engineFor(callId).getLiveBufferMs(callId),
    getFeedWatermarksMs: () => voice.getFeedWatermarksMs(),
    feedLiveVideo(callId: string, data: Uint8Array, timestampUs: number) {
      return engineFor(callId) === video ? video.feedLiveVideo(callId, data, timestampUs) : 0;
    },
    requestVideoKeyFrame(callId: string) {
      return engineFor(callId) === video ? video.requestVideoKeyFrame(callId) : false;
    },
    getCall: (callId: string) => engineFor(callId).getCall(callId),
    getCalls: allCalls,
    on(event: string, listener: (...args: any[]) => void) {
      voice.on(event as any, listener);
      video?.on(event as any, listener);
      subscriptions.push({ event, listener, wrapped: listener });
      return adapter;
    },
    off(event: string, listener: (...args: any[]) => void) {
      unsubscribe(event, listener);
      return adapter;
    },
    once(event: string, listener: (...args: any[]) => void) {
      const wrapped = (...args: any[]) => {
        unsubscribe(event, listener, wrapped);
        listener(...args);
      };
      voice.on(event as any, wrapped);
      video?.on(event as any, wrapped);
      subscriptions.push({ event, listener, wrapped });
      return adapter;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of subscriptions.splice(0)) {
        voice.off(entry.event as any, entry.wrapped);
        video?.off(entry.event as any, entry.wrapped);
      }
      try {
        voice.dispose();
      } finally {
        try {
          video?.dispose();
        } finally {
          for (const remove of unregister) remove();
          voiceCalls.clear();
          videoCalls.clear();
          videoStanzas.clear();
          reservations.clear();
        }
      }
    },
  };
  Object.defineProperties(adapter, {
    engine: { writable: false },
    videoEnabled: { writable: false },
  });
  return adapter;
}

export function connectCallAdapterPlugin(options: ConnectVoipPluginOptions = {}) {
  return defineWaClientPlugin<'voip', ReturnType<typeof createConnectCallAdapter>>({
    id: '@argws/connect-call-adapter',
    exposeAs: 'voip',
    setup: (ctx) => createConnectCallAdapter(ctx, options),
    dispose: (adapter) => adapter.dispose(),
  });
}
