import { RouterBroker } from '@api/abstract/abstract.router';
import { prismaRepository, waMonitor } from '@api/server.module';
import { ConfigService } from '@config/env.config';
import { Router } from 'express';

export class ConnectRouter extends RouterBroker {
  constructor(readonly configService: ConfigService) {
    super();
    this.router.post(this.routerPath('webhook/connect', false), async (req, res) => {
      const { body } = req;
      const numberId = body?.numberId;

      if (!numberId) {
        return res.status(200).json({ status: 'ignored', reason: 'numberId not found' });
      }

      const instance = await prismaRepository.instance.findFirst({
        where: { number: numberId, integration: 'CONNECT' },
      });
      if (!instance || !waMonitor.waInstances[instance.name]) {
        return res.status(200).json({ status: 'ignored', reason: 'legacy CONNECT instance not found' });
      }

      await waMonitor.waInstances[instance.name].connectToWhatsapp(body);
      return res.status(200).json({ status: 'success' });
    });
  }

  public readonly router: Router = Router();
}
