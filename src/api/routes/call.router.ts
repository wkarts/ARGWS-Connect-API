import { RouterBroker } from '@api/abstract/abstract.router';
import { CallIdDto, MuteCallDto, OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { callController } from '@api/server.module';
import { callIdSchema, muteCallSchema, offerCallSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class CallRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();

    this.router.post(this.routerPath('offer'), ...guards, async (req, res) => {
      const response = await this.dataValidate<OfferCallDto>({
        request: req,
        schema: offerCallSchema,
        ClassRef: OfferCallDto,
        execute: (instance, data) => callController.offerCall(instance, data),
      });
      return res.status(HttpStatus.CREATED).json(response);
    });

    this.router.post(this.routerPath('accept'), ...guards, async (req, res) => {
      const response = await this.dataValidate<CallIdDto>({
        request: req,
        schema: callIdSchema,
        ClassRef: CallIdDto,
        execute: (instance, data) => callController.acceptCall(instance, data),
      });
      return res.status(HttpStatus.OK).json(response);
    });

    this.router.post(this.routerPath('reject'), ...guards, async (req, res) => {
      const response = await this.dataValidate<CallIdDto>({
        request: req,
        schema: callIdSchema,
        ClassRef: CallIdDto,
        execute: (instance, data) => callController.rejectCall(instance, data),
      });
      return res.status(HttpStatus.OK).json(response);
    });

    this.router.post(this.routerPath('end'), ...guards, async (req, res) => {
      const response = await this.dataValidate<CallIdDto>({
        request: req,
        schema: callIdSchema,
        ClassRef: CallIdDto,
        execute: (instance, data) => callController.endCall(instance, data),
      });
      return res.status(HttpStatus.OK).json(response);
    });

    this.router.post(this.routerPath('mute'), ...guards, async (req, res) => {
      const response = await this.dataValidate<MuteCallDto>({
        request: req,
        schema: muteCallSchema,
        ClassRef: MuteCallDto,
        execute: (instance, data) => callController.muteCall(instance, data),
      });
      return res.status(HttpStatus.OK).json(response);
    });

    this.router.post(this.routerPath('mediaTicket'), ...guards, async (req, res) => {
      const response = await this.dataValidate<CallIdDto>({
        request: req,
        schema: callIdSchema,
        ClassRef: CallIdDto,
        execute: (instance, data) => callController.mediaTicket(instance, data),
      });
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      return res.status(HttpStatus.CREATED).json(response);
    });

    this.router.get(this.routerPath('list'), ...guards, async (req, res) => {
      const instance = req.params as unknown as InstanceDto;
      const response = await callController.listCalls(instance);
      return res.status(HttpStatus.OK).json(response);
    });
  }

  public readonly router: Router = Router();
}
