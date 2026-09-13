import { defineWaClientPlugin } from '@innovatorssoft/zapo-js';

import type { VoipEvents } from './engine/events.js';
import { WaVoipCoordinator, type WaVoipCoordinatorOptions } from './engine/WaVoipCoordinator.js';

export interface ConnectVoipPluginOptions extends WaVoipCoordinatorOptions {
  videoEnabled?: boolean;
  maxVideoFrameBytes?: number;
  maxVideoFps?: number;
}

/** Connect-owned media/signaling engine over the public Zapo plugin contract. */
export function connectVoipPlugin(options: ConnectVoipPluginOptions = {}) {
  return defineWaClientPlugin<'voip', WaVoipCoordinator & { readonly engine: 'connect' }, VoipEvents>({
    id: '@argws/connect-voip',
    exposeAs: 'voip',
    setup(ctx) {
      const coordinator = new WaVoipCoordinator(ctx, options);
      Object.defineProperty(coordinator, 'engine', { value: 'connect', enumerable: true });
      return coordinator as WaVoipCoordinator & { readonly engine: 'connect' };
    },
    dispose(coordinator) {
      coordinator.dispose();
    },
  });
}
