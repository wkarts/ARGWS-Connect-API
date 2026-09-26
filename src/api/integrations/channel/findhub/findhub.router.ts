import { RouterBroker } from '@api/abstract/abstract.router';
import {
  FindHubAuthStartDto,
  FindHubBrowserCompleteDto,
  FindHubBrowserExchangeDto,
  FindHubBrowserProofDto,
  FindHubCredentialBundleDto,
  FindHubDeviceAvatarDto,
  FindHubLocateDto,
  FindHubReconciliationDto,
  FindHubSettingsDto,
  FindHubSoundDto,
  FindHubTraccarConnectionDto,
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
  findHubDeviceAvatarSchema,
  findHubLocateSchema,
  findHubReconciliationSchema,
  findHubSettingsSchema,
  findHubSoundSchema,
  findHubTraccarConnectionSchema,
  findHubTraccarSchema,
  findHubTrackingSchema,
} from '@validate/findhub.schema';
import { RequestHandler, Router } from 'express';
import { resolve } from 'path';

import { findHubStream } from './services/findhub-stream';

export class FindHubRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();

    this.router
      .get('/tracking/snapshot/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.snapshot(req.params.instanceName)),
      )
      .get('/tracking/stream/:instanceName', ...guards, (req, res, next) => {
        void findHubStream(req, res, findHubController).catch(next);
      })
      .get('/tracking/settings/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.settings(req.params.instanceName)),
      )
      .put('/tracking/settings/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate({
            request: req,
            schema: findHubSettingsSchema,
            ClassRef: FindHubSettingsDto,
            execute: (instance, data) => findHubController.saveSettings(instance.instanceName, data),
          }),
        ),
      )
      .get('/traccar/configuration/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.traccarConfiguration(req.params.instanceName)),
      )
      .put('/traccar/configuration/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate({
            request: req,
            schema: findHubTraccarConnectionSchema,
            ClassRef: FindHubTraccarConnectionDto,
            execute: (instance, data) => findHubController.saveTraccarConfiguration(instance.instanceName, data),
          }),
        ),
      )
      .post('/traccar/provision/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.provisionTraccar(req.params.instanceName, req.params.deviceId)),
      )
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
      .post('/protocol/capture/catalog/:catalog/:instanceName', ...guards, async (req, res) => {
        const catalog = String(req.params.catalog || '').toLowerCase();
        const payload = await findHubController.captureProtocolCatalog(req.params.instanceName, catalog);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="findhub-devices-${catalog}-${Date.now()}.pb"`,
        );
        res.send(payload);
      })
      .get('/device/avatar/:deviceId/:instanceName', ...guards, async (req, res) => {
        const device = await findHubController.device(req.params.instanceName, req.params.deviceId);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ avatarData: device.avatarData ?? null });
      })
      .put('/device/avatar/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubDeviceAvatarDto>({
            request: req,
            schema: findHubDeviceAvatarSchema,
            ClassRef: FindHubDeviceAvatarDto,
            execute: (instance, data) =>
              findHubController.setDeviceAvatar(instance.instanceName, req.params.deviceId, data.avatar),
          }),
        ),
      )
      .get('/device/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.device(req.params.instanceName, req.params.deviceId)),
      )
      .post('/locate/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubLocateDto>({
            request: req,
            schema: findHubLocateSchema,
            ClassRef: FindHubLocateDto,
            execute: (instance, data) =>
              findHubController.locate(instance.instanceName, req.params.deviceId, data.timeoutMs),
          }),
        ),
      )
      .post('/protocol/capture/device-update/:deviceId/:instanceName', ...guards, async (req, res) => {
        const result = await this.dataValidate<FindHubLocateDto>({
          request: req,
          schema: findHubLocateSchema,
          ClassRef: FindHubLocateDto,
          execute: (instance, data) =>
            findHubController.captureProtocolDeviceUpdate(
              instance.instanceName,
              req.params.deviceId,
              data.timeoutMs,
            ),
        });
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-FindHub-Device-Metadata-Bytes', String(result.deviceMetadata.length));
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="findhub-device-update-${req.params.deviceId}-${Date.now()}.pb"`,
        );
        res.send(result.payload);
      })
      .post('/sound/start/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubSoundDto>({
            request: req,
            schema: findHubSoundSchema,
            ClassRef: FindHubSoundDto,
            execute: (instance, data) =>
              findHubController.sound(instance.instanceName, req.params.deviceId, 'start', data),
          }),
        ),
      )
      .post('/sound/stop/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubSoundDto>({
            request: req,
            schema: findHubSoundSchema,
            ClassRef: FindHubSoundDto,
            execute: (instance, data) =>
              findHubController.sound(instance.instanceName, req.params.deviceId, 'stop', data),
          }),
        ),
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
            typeof req.query.from === 'string' ? req.query.from : undefined,
            typeof req.query.to === 'string' ? req.query.to : undefined,
          ),
        ),
      )
      .post('/positions/reconcile/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubReconciliationDto>({
            request: req,
            schema: findHubReconciliationSchema,
            ClassRef: FindHubReconciliationDto,
            execute: (instance, data) =>
              findHubController.reconcileDevice(instance.instanceName, req.params.deviceId, data),
          }),
        ),
      )
      .post('/positions/reconcile/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubReconciliationDto>({
            request: req,
            schema: findHubReconciliationSchema,
            ClassRef: FindHubReconciliationDto,
            execute: (instance, data) => findHubController.reconcileAll(instance.instanceName, data),
          }),
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
