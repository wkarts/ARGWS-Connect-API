export type ConnectVoipEngine = 'connect' | 'zapo-native';

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return value?.trim() && Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

/** Settings are optional; invalid numbers cannot remove media resource limits. */
export function getConnectVideoConfig() {
  const even = (value: number) => value - (value % 2);
  return {
    enabled: process.env.CONNECT_VIDEO_ENABLED !== 'false',
    maxFrameBytes: boundedInteger(process.env.CONNECT_VIDEO_MAX_FRAME_BYTES, 8 * 1024 * 1024, 1024, 8 * 1024 * 1024),
    maxFps: boundedInteger(process.env.CONNECT_VIDEO_MAX_FPS, 30, 1, 30),
    width: even(boundedInteger(process.env.CONNECT_VIDEO_WIDTH, 640, 160, 1280)),
    height: even(boundedInteger(process.env.CONNECT_VIDEO_HEIGHT, 480, 120, 720)),
    bitrate: boundedInteger(process.env.CONNECT_VIDEO_BITRATE, 800_000, 100_000, 4_000_000),
  };
}

/** Never silently switch to a different call implementation after a failure. */
export function getConnectVoipEngine(): ConnectVoipEngine {
  const engine = process.env.CONNECT_VOIP_ENGINE || 'connect';
  if (engine !== 'connect' && engine !== 'zapo-native') {
    throw new Error('CONNECT_VOIP_ENGINE must be connect or zapo-native');
  }
  return engine;
}
