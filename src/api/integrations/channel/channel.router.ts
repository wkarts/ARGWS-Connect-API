import { Router } from 'express';

import { ConnectCompatibilityRouter } from './connect/connect.compat';
import { MetaRouter } from './meta/meta.router';
import { BaileysRouter } from './whatsapp/baileys.router';

export class ChannelRouter {
  public readonly router: Router;

  constructor(configService: any, ...guards: any[]) {
    this.router = Router();

    // Compatibility endpoint for existing 1.0.21 CONNECT integrations only.
    // CONNECT remains absent from the current instance-creation contract and
    // this compatibility route stays outside generated public documentation.
    this.router.use('/', new ConnectCompatibilityRouter(configService).router);
    this.router.use('/', new MetaRouter(configService).router);
    this.router.use('/baileys', new BaileysRouter(...guards).router);
  }
}
