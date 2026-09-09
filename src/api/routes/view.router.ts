import { RouterBroker } from '@api/abstract/abstract.router';
import { internalDocsTarget } from '@utils/internalDocsTarget';
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

    // Same-origin documentation facade. Upstream host comes only from ENV.
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
          const target = internalDocsTarget(docsInternalUrl, req.url);
          const upstream = await fetch(target, {
            method: req.method,
            signal: controller.signal,
            redirect: 'manual',
            headers: {
              accept: req.get('accept') || '*/*',
              'accept-language': req.get('accept-language') || 'pt-BR,pt;q=0.9',
              ...(req.get('if-none-match') ? { 'if-none-match': req.get('if-none-match') as string } : {}),
              ...(req.get('if-modified-since') ? { 'if-modified-since': req.get('if-modified-since') as string } : {}),
              ...(req.get('range') ? { range: req.get('range') as string } : {}),
            },
          });

          const location = upstream.headers.get('location');
          if (location) {
            const redirected = new URL(location, target);
            if (redirected.origin !== target.origin || redirected.username || redirected.password) {
              await upstream.body?.cancel();
              return res.status(502).type('text/plain').send('Redirecionamento externo da documentação recusado.');
            }
            res.set('location', `${docsBasePath.replace(/\/$/, '')}${redirected.pathname}${redirected.search}`);
          }

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
