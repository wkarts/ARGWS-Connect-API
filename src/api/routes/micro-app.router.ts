import { RouterBroker } from '@api/abstract/abstract.router';
import { MicroAppSessionDto, MicroAppSubmitDto } from '@api/dto/micro-app.dto';
import { microAppController } from '@api/server.module';
import { createMetaErrorResponse } from '@utils/errorResponse';
import { microAppSessionSchema, microAppSubmitSchema } from '@validate/microApp.schema';
import { Request, RequestHandler, Response, Router } from 'express';
import { validate } from 'jsonschema';

import { HttpStatus } from './index.router';

function publicHeaders(res: Response) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

function clientIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || undefined;
}

export class MicroAppRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();

    this.router.post('/session/:instanceName', ...guards, async (req, res) => {
      try {
        const response = await this.dataValidate<MicroAppSessionDto>({
          request: req,
          schema: microAppSessionSchema,
          ClassRef: MicroAppSessionDto,
          execute: (instance, data) => microAppController.createSession(instance, data),
        });
        res.status(HttpStatus.CREATED).json(response);
      } catch (error) {
        const response = createMetaErrorResponse(error, 'micro_app_session_create');
        res.status(response.status).json(response);
      }
    });

    this.router.get('/runtime.js', (_req, res) => {
      publicHeaders(res);
      res.type('application/javascript; charset=utf-8').send(microAppController.runtimeScript());
    });

    this.router.get('/state/:token', async (req, res) => {
      publicHeaders(res);
      try {
        const response = await microAppController.state(req.params.token);
        res.status(HttpStatus.OK).json(response);
      } catch (error) {
        const response = createMetaErrorResponse(error, 'micro_app_state');
        res.status(response.status).json(response);
      }
    });

    this.router.post('/submit/:token', async (req, res) => {
      publicHeaders(res);
      try {
        const data = Object.assign(new MicroAppSubmitDto(), req.body || {});
        const validation = validate(data, microAppSubmitSchema);
        if (!validation.valid) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            status: HttpStatus.BAD_REQUEST,
            error: 'INVALID_MICRO_APP_PAYLOAD',
            message: validation.errors.map((item) => item.stack.replace('instance.', '')).join('; '),
          });
        }
        const response = await microAppController.submit(req.params.token, data, clientIp(req));
        res.status(HttpStatus.OK).json(response);
      } catch (error) {
        const response = createMetaErrorResponse(error, 'micro_app_submit');
        res.status(response.status).json(response);
      }
    });

    this.router.get('/:token', (req, res) => {
      publicHeaders(res);
      try {
        res.type('html').send(microAppController.html(req.params.token));
      } catch (error) {
        const response = createMetaErrorResponse(error, 'micro_app_html');
        res.status(response.status).type('text/plain').send('Micro App indisponível.');
      }
    });
  }

  public readonly router: Router = Router();
}
