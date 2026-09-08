import { RouterBroker } from '@api/abstract/abstract.router';
import { connectController } from '@api/server.module';
import { ConfigService } from '@config/env.config';
import { Router } from 'express';

export class ConnectRouter extends RouterBroker {
  constructor(readonly configService: ConfigService) {
    super();
    this.router.post(this.routerPath('webhook/connect', false), async (req, res) => {
      const { body } = req;
      const response = await connectController.receiveWebhook(body);

      return res.status(200).json(response);
    });
  }

  public readonly router: Router = Router();
}
