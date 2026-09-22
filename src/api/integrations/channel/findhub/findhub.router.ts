import { RouterBroker } from '@api/abstract/abstract.router';
import {
  FindHubAuthStartDto,
  FindHubBrowserCompleteDto,
  FindHubBrowserExchangeDto,
  FindHubBrowserProofDto,
  FindHubCredentialBundleDto,
  FindHubTraccarDto,
  FindHubTrackingDto,
} from '@api/dto/findhub.dto';
import { findHubController } from '@api/server.module';
import {
  findHubAuthStartSchema,
  findHubBrowserCancelSchema,
  findHubBrowserCompleteSchema,
  findHubBrowserExchangeSchema,
  findHubBrowserStartSchema,
  findHubCredentialBundleSchema,
  findHubTraccarSchema,
  findHubTrackingSchema,
} from '@validate/findhub.schema';
import { RequestHandler, Router } from 'express';
import { resolve } from 'path';

export class FindHubRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();

    this.router
      .get('/auth/extension/:instanceName', ...guards, (req, res, next) => {
        findHubController.extensionAllowed(req.params.instanceName);
        res.setHeader('Cache-Control', 'no-store');
        res.download(resolve(process.cwd(), 'public/findhub-auth.zip'), 'Connect-FindHub-Auth.zip', (error) => {
          if (error) next(error);
        });
      })
      .post('/disconnect/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.disconnect(req.params.instanceName)),
      )
      .get('/traccar/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.traccar(req.params.instanceName, req.params.deviceId)),
      )
      .post('/auth/browser/start/:instanceName', ...guards, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json(
          await this.dataValidate({
            request: req,
            schema: findHubBrowserStartSchema,
            ClassRef: FindHubAuthStartDto,
            execute: (instance, data) => findHubController.browserAuth(instance.instanceName, 'start', data),
          }),
        );
      })
      .post('/auth/browser/exchange/:instanceName', ...guards, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(
          await this.dataValidate({
            request: req,
            schema: findHubBrowserExchangeSchema,
            ClassRef: FindHubBrowserExchangeDto,
            execute: (instance, data) => findHubController.browserAuth(instance.instanceName, 'exchange', data),
          }),
        );
      })
      .post('/auth/browser/complete/:instanceName', ...guards, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(
          await this.dataValidate({
            request: req,
            schema: findHubBrowserCompleteSchema,
            ClassRef: FindHubBrowserCompleteDto,
            execute: (instance, data) => findHubController.browserAuth(instance.instanceName, 'complete', data),
          }),
        );
      })
      .post('/auth/browser/cancel/:instanceName', ...guards, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(
          await this.dataValidate({
            request: req,
            schema: findHubBrowserCancelSchema,
            ClassRef: FindHubBrowserProofDto,
            execute: (instance, data) => findHubController.browserAuth(instance.instanceName, 'cancel', data),
          }),
        );
      })
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
