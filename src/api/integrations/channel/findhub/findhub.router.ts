import { RouterBroker } from '@api/abstract/abstract.router';
import {
  FindHubAuthStartDto,
  FindHubCredentialBundleDto,
  FindHubTraccarDto,
  FindHubTrackingDto,
} from '@api/dto/findhub.dto';
import { findHubController } from '@api/server.module';
import {
  findHubAuthStartSchema,
  findHubCredentialBundleSchema,
  findHubTraccarSchema,
  findHubTrackingSchema,
} from '@validate/findhub.schema';
import { RequestHandler, Router } from 'express';

export class FindHubRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();

    this.router
      .post('/auth/start/:instanceName', ...guards, async (req, res) =>
        res.status(201).json(
          await this.dataValidate({
            request: req,
            schema: findHubAuthStartSchema,
            ClassRef: FindHubAuthStartDto,
            execute: (instance, data) => findHubController.startAuth(instance.instanceName, data),
          }),
        ),
      )
      .post('/auth/import/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate({
            request: req,
            schema: findHubCredentialBundleSchema,
            ClassRef: FindHubCredentialBundleDto,
            execute: (instance, data) => findHubController.importCredentials(instance.instanceName, data),
          }),
        ),
      )
      .get('/auth/status/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.status(req.params.instanceName)),
      )
      .get('/devices/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.devices(req.params.instanceName)),
      )
      .post('/devices/refresh/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.refreshDevices(req.params.instanceName)),
      )
      .get('/device/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.device(req.params.instanceName, req.params.deviceId)),
      )
      .post('/locate/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.locate(req.params.instanceName, req.params.deviceId)),
      )
      .post('/tracking/start/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate({
            request: req,
            schema: findHubTrackingSchema,
            ClassRef: FindHubTrackingDto,
            execute: (instance, data) =>
              findHubController.startTracking(instance.instanceName, req.params.deviceId, data),
          }),
        ),
      )
      .post('/tracking/stop/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.stopTracking(req.params.instanceName, req.params.deviceId)),
      )
      .get('/positions/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await findHubController.positions(
            req.params.instanceName,
            req.params.deviceId,
            Number(req.query.limit || 100),
          ),
        ),
      )
      .put('/traccar/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate({
            request: req,
            schema: findHubTraccarSchema,
            ClassRef: FindHubTraccarDto,
            execute: (instance, data) => findHubController.setTraccar(instance.instanceName, req.params.deviceId, data),
          }),
        ),
      )
      .delete('/traccar/:deviceId/:instanceName', ...guards, async (req, res) => {
        await findHubController.removeTraccar(req.params.instanceName, req.params.deviceId);
        res.status(204).send();
      });
  }
}
