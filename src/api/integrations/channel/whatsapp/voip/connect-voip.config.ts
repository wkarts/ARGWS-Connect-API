export type ConnectVoipEngine = 'connect' | 'zapo-native';

/** Develop video support is enabled with fixed, bounded media settings; no environment setup is required. */
export function getConnectVideoConfig() {
  return {
    enabled: true,
    maxFrameBytes: 8 * 1024 * 1024,
    maxFps: 30,
    width: 640,
    height: 480,
    bitrate: 800_000,
  };
}

/** Never silently switch to a different call implementation after a failure. */
export function getConnectVoipEngine(): ConnectVoipEngine {
  return 'connect';
}
