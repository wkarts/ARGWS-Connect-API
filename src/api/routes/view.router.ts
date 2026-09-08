import { RouterBroker } from '@api/abstract/abstract.router';
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
    features: {
      voice: envBoolean('MANAGER_FEATURE_VOICE', true),
      voiceExtensions: envBoolean('MANAGER_FEATURE_VOICE_EXTENSIONS', false),
      voiceQueues: envBoolean('MANAGER_FEATURE_VOICE_QUEUES', false),
      flows: envBoolean('MANAGER_FEATURE_FLOWS', false),
      automations: envBoolean('MANAGER_FEATURE_AUTOMATIONS', false),
      docs: envBoolean('MANAGER_FEATURE_DOCS', true),
      contacts: envBoolean('MANAGER_FEATURE_CONTACTS', true),
      messages: envBoolean('MANAGER_FEATURE_MESSAGES', true),
      users: envBoolean('MANAGER_FEATURE_USERS', false),
      permissions: envBoolean('MANAGER_FEATURE_PERMISSIONS', false),
      audit: envBoolean('MANAGER_FEATURE_AUDIT', false),
      security: envBoolean('MANAGER_FEATURE_SECURITY', false),
      updates: envBoolean('MANAGER_FEATURE_UPDATES', true),
      settings: envBoolean('MANAGER_FEATURE_SETTINGS', true),
    },
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

        try {
          const suffix = req.url === '/' ? '/' : req.url;
          const target = new URL(`${docsBasePath.replace(/\/$/, '')}${suffix}`, docsInternalUrl);
          const upstream = await fetch(target, {
            method: req.method,
            headers: {
              accept: req.get('accept') || '*/*',
              'accept-language': req.get('accept-language') || 'pt-BR,pt;q=0.9',
            },
          });

          res.status(upstream.status);
          for (const header of ['content-type', 'cache-control', 'etag', 'last-modified']) {
            const value = upstream.headers.get(header);
            if (value) res.set(header, value);
          }

          if (req.method === 'HEAD') return res.end();
          const body = Buffer.from(await upstream.arrayBuffer());
          return res.send(body);
        } catch {
          return res.status(502).type('text/plain').send('Documentação interna temporariamente indisponível.');
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
