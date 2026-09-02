import { RouterBroker } from '@api/abstract/abstract.router';
import { StrongConfirmationDecisionDto } from '@api/dto/strong-confirmation.dto';
import { strongConfirmationController } from '@api/server.module';
import { createMetaErrorResponse } from '@utils/errorResponse';
import { strongConfirmationDecisionSchema } from '@validate/strong-confirmation.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class StrongConfirmationRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .get(this.routerPath('pending'), ...guards, async (req, res) => {
        try {
          const response = await strongConfirmationController.pending(req.params.instanceName);
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'strong_confirmation_pending');
          res.status(response.status).json(response);
        }
      })
      .post(this.routerPath('approve'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<StrongConfirmationDecisionDto>({
            request: req,
            schema: strongConfirmationDecisionSchema,
            ClassRef: StrongConfirmationDecisionDto,
            execute: (instance, data) => strongConfirmationController.approve(instance.instanceName, data),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'strong_confirmation_approve');
          res.status(response.status).json(response);
        }
      })
      .post(this.routerPath('reject'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<StrongConfirmationDecisionDto>({
            request: req,
            schema: strongConfirmationDecisionSchema,
            ClassRef: StrongConfirmationDecisionDto,
            execute: (instance, data) => strongConfirmationController.reject(instance.instanceName, data),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'strong_confirmation_reject');
          res.status(response.status).json(response);
        }
      });
  }
}
