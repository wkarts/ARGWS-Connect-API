import { RouterBroker } from '@api/abstract/abstract.router';
import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { HttpStatus } from '@api/routes/index.router';
import { connectAIController } from '@api/server.module';
import {
  connectAIIgnoreJidSchema,
  connectAISchema,
  connectAISettingSchema,
  connectAIStatusSchema,
  instanceSchema,
} from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { ConnectAIDto, ConnectAISettingDto } from '../dto/connectAI.dto';

export class ConnectAIRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req, res) => {
        const response = await this.dataValidate<ConnectAIDto>({
          request: req,
          schema: connectAISchema,
          ClassRef: ConnectAIDto,
          execute: (instance, data) => connectAIController.createBot(instance, data),
        });

        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => connectAIController.findBot(instance),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetch/:connectAIId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => connectAIController.fetchBot(instance, req.params.connectAIId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .put(this.routerPath('update/:connectAIId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<ConnectAIDto>({
          request: req,
          schema: connectAISchema,
          ClassRef: ConnectAIDto,
          execute: (instance, data) => connectAIController.updateBot(instance, req.params.connectAIId, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete/:connectAIId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => connectAIController.deleteBot(instance, req.params.connectAIId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<ConnectAISettingDto>({
          request: req,
          schema: connectAISettingSchema,
          ClassRef: ConnectAISettingDto,
          execute: (instance, data) => connectAIController.settings(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => connectAIController.fetchSettings(instance),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: connectAIStatusSchema,
          ClassRef: InstanceDto,
          execute: (instance, data) => connectAIController.changeStatus(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSessions/:connectAIId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => connectAIController.fetchSessions(instance, req.params.connectAIId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req, res) => {
        const response = await this.dataValidate<IgnoreJidDto>({
          request: req,
          schema: connectAIIgnoreJidSchema,
          ClassRef: IgnoreJidDto,
          execute: (instance, data) => connectAIController.ignoreJid(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
