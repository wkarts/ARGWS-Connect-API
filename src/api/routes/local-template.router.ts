import { RouterBroker } from '@api/abstract/abstract.router';
import { localTemplateService } from '@api/server.module';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

// Keep native guards, but never merge query/body fields over the authorized route identity.
export class LocalTemplateRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.status(HttpStatus.OK).json(await localTemplateService.list(req.params.instanceName, req.query));
      })
      .post(this.routerPath('create'), ...guards, async (req, res) => {
        res.status(HttpStatus.CREATED).json(await localTemplateService.create(req.params.instanceName, req.body));
      })
      .post(this.routerPath('edit'), ...guards, async (req, res) => {
        res.status(HttpStatus.OK).json(await localTemplateService.edit(req.params.instanceName, req.body));
      })
      .delete(this.routerPath('delete'), ...guards, async (req, res) => {
        res.status(HttpStatus.OK).json(await localTemplateService.archive(req.params.instanceName, req.body));
      });
  }

  public readonly router: Router = Router();
}
