import { RouterBroker } from '@api/abstract/abstract.router';
import { metaController } from '@api/server.module';
import { ConfigService, WaBusiness } from '@config/env.config';
import { Router } from 'express';

export class MetaRouter extends RouterBroker {
  constructor(readonly configService: ConfigService) {
    super();
    this.router
      .get(this.routerPath('webhook/meta', false), async (req, res) => {
        const verifyToken = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const expectedToken = configService.get<WaBusiness>('WA_BUSINESS').TOKEN_WEBHOOK;

        if (verifyToken !== expectedToken) {
          return res.status(403).type('text/plain').end('Error, wrong validation token');
        }

        if (typeof challenge !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/.test(challenge)) {
          return res.status(400).type('text/plain').end('Invalid challenge');
        }

        res.status(200).type('text/plain').end(challenge);
      })
      .post(this.routerPath('webhook/meta', false), async (req, res) => {
        const { body } = req;
        const response = await metaController.receiveWebhook(body);

        return res.status(200).json(response);
      });
  }

  public readonly router: Router = Router();
}
