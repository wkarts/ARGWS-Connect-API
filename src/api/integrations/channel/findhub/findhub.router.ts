import { RouterBroker } from '@api/abstract/abstract.router';
import {
  FindHubAuthStartDto,
  FindHubBrowserCompleteDto,
  FindHubBrowserExchangeDto,
  FindHubBrowserProofDto,
  FindHubCredentialBundleDto,
  FindHubDeviceSettingsDto,
  FindHubLocateDto,
  FindHubMonitoringDto,
  FindHubTraccarDto,
  FindHubTrackingDto,
} from '@api/dto/findhub.dto';
import { findHubController } from '@api/server.module';
import { BadRequestException } from '@exceptions';
import {
  findHubAuthStartSchema,
  findHubBrowserCancelSchema,
  findHubBrowserCompleteSchema,
  findHubBrowserExchangeSchema,
  findHubBrowserStartSchema,
  findHubCredentialBundleSchema,
  findHubDeviceSettingsSchema,
  findHubLocateSchema,
  findHubMonitoringSchema,
  findHubTraccarSchema,
  findHubTrackingSchema,
} from '@validate/findhub.schema';
import { RequestHandler, Router } from 'express';
import { resolve } from 'path';

export class FindHubRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super();

    this.router.use((req, _res, next) => {
      if (
        Object.prototype.hasOwnProperty.call(req.query, 'instanceName') ||
        Object.prototype.hasOwnProperty.call(req.query, 'deviceId')
      ) {
        throw new BadRequestException('A instância e o dispositivo devem ser definidos no caminho, não na query.');
      }
      next();
    });

    this.router
      .get('/settings/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.settings(req.params.instanceName)),
      )
      .put('/settings/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubMonitoringDto>({
            request: req,
            schema: findHubMonitoringSchema,
            ClassRef: FindHubMonitoringDto,
            execute: (instance, data) => findHubController.saveSettings(instance.instanceName, data),
          }),
        ),
      )
      .put('/device/:deviceId/settings/:instanceName', ...guards, async (req, res) =>
        res.json(
          await this.dataValidate<FindHubDeviceSettingsDto>({
            request: req,
            schema: findHubDeviceSettingsSchema,
            ClassRef: FindHubDeviceSettingsDto,
            execute: (instance, data) =>
              findHubController.configureDevice(instance.instanceName, req.params.deviceId, data),
          }),
        ),
      )
      .get('/location/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(await findHubController.latestPosition(req.params.instanceName, req.params.deviceId)),
      )
      .get('/history/:deviceId/:instanceName', ...guards, async (req, res) =>
        res.json(
          await findHubController.history(req.params.instanceName, req.params.deviceId, {
            limit: Number(req.query.limit || 100),
            cursor: req.query.cursor ? String(req.query.cursor) : undefined,
            from: req.query.from ? String(req.query.from) : undefined,
            to: req.query.to ? String(req.query.to) : undefined,
          }),
        ),
      )
      .get('/events/stream/:instanceName', ...guards, (req, res) => {
        // Same instance authorization as REST. Never put credentials in a query string.
        let closed = false;
        const release = findHubController.subscribe(req.params.instanceName, (message) => {
          if (closed) return;
          if (!res.write(`data: ${JSON.stringify(message)}\n\n`)) res.destroy();
          (res as any).flush?.();
        });
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        res.write(
          `data: ${JSON.stringify({ event: 'findhub.stream.ready', data: {}, receivedAt: new Date().toISOString() })}\n\n`,
        );
        (res as any).flush?.();
        const heartbeat = setInterval(() => {
          if (!closed && !res.write(': heartbeat\n\n')) res.destroy();
          (res as any).flush?.();
        }, 15000);
        heartbeat.unref?.();
        const lifetime = setTimeout(() => res.end(), 900000);
        lifetime.unref?.();
        res.on('close', () => {
          closed = true;
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          release();
        });
      })
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
