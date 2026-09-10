import { RouterBroker } from '@api/abstract/abstract.router';
import { managerFeatures } from '@config/manager-features.config';
import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function managerRuntimeConfig() {
  return {
    compatibility: 'current',
    apiBaseUrl: process.env.MANAGER_API_BASE_URL?.trim() || '',
    serviceBasePath: '/manager-api/v1',
    requestTimeoutMs: Number.parseInt(process.env.MANAGER_REQUEST_TIMEOUT_MS || '30000', 10) || 30000,
    authMode: process.env.MANAGER_AUTH_MODE === 'account' ? 'account' : 'access-code',
    features: managerFeatures(),
  };
}

export class ViewsRouter extends RouterBroker {
  public readonly router: Router;

  constructor() {
    super();
    this.router = Router();

    const basePath = path.join(process.cwd(), 'manager', 'dist');
    const indexPath = path.join(basePath, 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    // Runtime configuration is emitted by the API container so production can
    // hide unfinished screens through ENV without rebuilding the Manager.
    this.router.get('/assets/runtime-config.js', (_req, res) => {
      const config = JSON.stringify(managerRuntimeConfig()).replace(/</g, '\\u003c');
      res
        .status(200)
        .type('application/javascript')
        .set('Cache-Control', 'no-store, max-age=0')
        .send(`window.__CONNECT_WEB__ = Object.freeze(${config});\n`);
    });

    // Internal API documentation. The Scalar service stays on the Docker
    // network and is surfaced to the authenticated Manager UX through the API
    // origin instead of requiring a second public documentation endpoint.
    if (envBoolean('MANAGER_FEATURE_DOCS', true)) {
      const docsInternalUrl =
        process.env.ARGWS_CONNECT_DOCS_INTERNAL_URL?.trim() || 'http://docs-argws-connect-production:8080';
      const docsBasePath = process.env.ARGWS_CONNECT_DOCS_INTERNAL_BASE_PATH?.trim() || '/manager/docs';

      this.router.use('/docs', async (req, res) => {
        if (!['GET', 'HEAD'].includes(req.method)) {
          return res.status(405).send('Method Not Allowed');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          // The DOCs container serves its application at `/`. The public-facing
          // prefix belongs to this API router only, so strip `/manager/docs`
          // before forwarding. Relative DOCs assets then resolve back through
          // this same endpoint without a second public hostname.
          const suffix = req.url === '/' ? '/' : req.url.startsWith('/') ? req.url : `/${req.url}`;
          const target = new URL(suffix, `${docsInternalUrl.replace(/\/$/, '')}/`);
          const upstream = await fetch(target, {
            method: req.method,
            signal: controller.signal,
            headers: {
              accept: req.get('accept') || '*/*',
              'accept-language': req.get('accept-language') || 'pt-BR,pt;q=0.9',
              ...(req.get('if-none-match') ? { 'if-none-match': req.get('if-none-match') as string } : {}),
              ...(req.get('if-modified-since') ? { 'if-modified-since': req.get('if-modified-since') as string } : {}),
              ...(req.get('range') ? { range: req.get('range') as string } : {}),
            },
          });

          res.status(upstream.status);
          for (const header of [
            'content-type',
            'cache-control',
            'etag',
            'last-modified',
            'content-range',
            'accept-ranges',
          ]) {
            const value = upstream.headers.get(header);
            if (value) res.set(header, value);
          }

          const location = upstream.headers.get('location');
          if (location) {
            try {
              const redirected = new URL(location, target);
              const internal = new URL(docsInternalUrl);
              if (redirected.origin === internal.origin) {
                res.set('location', `${docsBasePath.replace(/\/$/, '')}${redirected.pathname}${redirected.search}`);
              } else {
                res.set('location', location);
              }
            } catch {
              res.set('location', location);
            }
          }

          res.set('X-Connect-Docs-Proxy', 'internal');
          if (req.method === 'HEAD' || upstream.status === 304) return res.end();
          const body = Buffer.from(await upstream.arrayBuffer());
          return res.send(body);
        } catch {
          return res.status(502).type('text/plain').send('Documentação interna temporariamente indisponível.');
        } finally {
          clearTimeout(timeout);
        }
      });
    }

    this.router.use(
      express.static(basePath, {
        dotfiles: 'deny',
        index: false,
      }),
    );

    this.router.get('*', (_req, res) => {
      res.status(200).type('html').send(indexHtml);
    });
  }
}
