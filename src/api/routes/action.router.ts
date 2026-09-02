import { RouterBroker } from '@api/abstract/abstract.router';
import { ActionDeleteDto, ActionExecuteDto, IntegrationActionDto } from '@api/dto/action.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { actionController } from '@api/server.module';
import { createMetaErrorResponse } from '@utils/errorResponse';
import { actionDeleteSchema, actionExecuteSchema, actionSchema } from '@validate/action.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class ActionRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<IntegrationActionDto>({
            request: req,
            schema: actionSchema,
            ClassRef: IntegrationActionDto,
            execute: (instance, data) => actionController.create(instance, data),
          });
          res.status(HttpStatus.CREATED).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'action_create');
          res.status(response.status).json(response);
        }
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        try {
          const response = await actionController.find(req.params as unknown as InstanceDto);
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'action_find');
          res.status(response.status).json(response);
        }
      })
      .post(this.routerPath('execute'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<ActionExecuteDto>({
            request: req,
            schema: actionExecuteSchema,
            ClassRef: ActionExecuteDto,
            execute: (instance, data) => actionController.execute(instance, data),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'action_execute');
          res.status(response.status).json(response);
        }
      })
      .delete(this.routerPath('delete'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<ActionDeleteDto>({
            request: req,
            schema: actionDeleteSchema,
            ClassRef: ActionDeleteDto,
            execute: (instance, data) => actionController.delete(instance, data),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'action_delete');
          res.status(response.status).json(response);
        }
      });
  }

  public readonly router: Router = Router();
}
