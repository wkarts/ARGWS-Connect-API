import assert from 'node:assert/strict';

import { MicroAppService } from '../../src/api/services/micro-app.service';

const cacheStore = new Map<string, unknown>();
const sentTemplates: any[] = [];
const actionCalls: any[] = [];

const template = {
  policy: {
    microApps: {
      apps: [
        {
          key: 'checkin',
          title: 'Check-in',
          startPage: 'identify',
          ttlSeconds: 600,
          pages: [
            {
              key: 'identify',
              title: 'Identificação',
              captureRoot: 'form',
              components: [{ type: 'TEXT', id: 'name', label: 'Nome' }],
              next: 'location',
            },
            {
              key: 'location',
              title: 'Localização',
              location: {
                mode: 'REQUIRED',
                capturePath: 'visit.location',
                policy: {
                  enabled: true,
                  allowedSources: ['MICRO_APP_GPS'],
                  maxAccuracyMeters: 100,
                  geofences: [
                    {
                      id: 'office',
                      name: 'Escritório',
                      latitude: -12.9714,
                      longitude: -38.5014,
                      radiusMeters: 500,
                    },
                  ],
                  outsideGeofence: 'BLOCK',
                },
              },
              submit: {
                type: 'ACTION',
                key: 'checkin.register',
                input: {
                  name: '{{input.form.name}}',
                  latitude: '{{input.visit.location.latitude}}',
                },
                resultPath: 'checkin.result',
                confirmed: true,
              },
            },
          ],
          completion: {
            template: {
              name: 'checkin_completed',
              variables: { protocol: '{{input.checkin.result.protocol}}' },
            },
          },
        },
      ],
    },
  },
};

const prisma: any = {
  instance: {
    findUnique: async ({ where }: any) => {
      if (where.name === 'demo' || where.id === 'inst-1') {
        return { id: 'inst-1', name: 'demo', integration: 'WHATSAPP-BUSINESS' };
      }
      return null;
    },
  },
  template: {
    findFirst: async () => ({
      id: 'tpl-1',
      name: 'checkin_start',
      language: 'pt_BR',
      enabled: true,
      ...template,
    }),
  },
};

const cache: any = {
  get: async (key: string) => cacheStore.get(key),
  set: async (key: string, value: unknown) => {
    cacheStore.set(key, value);
  },
};

const config: any = {
  get: (key: string) => {
    if (key === 'AUTHENTICATION') return { API_KEY: { KEY: 'phase6-test-secret-key' } };
    if (key === 'SERVER') return { URL: 'https://api.example.test', TYPE: 'https', PORT: 443 };
    return {};
  },
};

const actions: any = {
  execute: async (_instance: any, request: any) => {
    actionCalls.push(request);
    return { protocol: 'CHK-001', received: request.input };
  },
};
const recipes: any = { execute: async () => ({}) };
const templates: any = {
  send: async (instance: any, data: any) => {
    sentTemplates.push({ instance, data });
    return { key: { id: 'out-1' } };
  },
};

const service = new MicroAppService(prisma, cache, config, actions, recipes, templates);
const created = await service.createSession(
  { instanceName: 'demo', instanceId: 'inst-1', integration: 'WHATSAPP-BUSINESS' },
  {
    templateName: 'checkin_start',
    language: 'pt_BR',
    appKey: 'checkin',
    number: '5575999999999',
    variables: { customerId: 'c-1', apiToken: 'must-not-leak' },
  },
);

assert.match(created.url, /^https:\/\/api\.example\.test\/micro-app\//);
assert.equal(created.pageKey, 'identify');
assert.ok(created.token.includes('.'));

const initial: any = await service.state(created.token);
assert.equal(initial.page.key, 'identify');
assert.equal(initial.variables.customerId, 'c-1');
assert.equal(initial.variables.apiToken, undefined, 'sensitive variable names must be stripped from public state');

const locationPage: any = await service.submit(created.token, {
  direction: 'NEXT',
  values: { name: 'Wallace' },
});
assert.equal(locationPage.page.key, 'location');
assert.equal(locationPage.variables.form.name, 'Wallace');

const completed: any = await service.submit(created.token, {
  direction: 'NEXT',
  location: {
    latitude: -12.9714,
    longitude: -38.5014,
    accuracy: 15,
    capturedAt: '2026-09-02T12:00:00.000Z',
  },
});

assert.equal(completed.completed, true);
assert.equal(actionCalls.length, 1);
assert.equal(actionCalls[0].actionKey, 'checkin.register');
assert.equal(actionCalls[0].input.name, 'Wallace');
assert.equal(String(actionCalls[0].input.latitude), '-12.9714');
assert.equal(sentTemplates.length, 1);
assert.equal(sentTemplates[0].data.name, 'checkin_completed');
assert.equal(sentTemplates[0].data.variables.protocol, 'CHK-001');

const html = service.htmlShell(created.token);
assert.match(html, /Connect\|API Micro App/);
assert.match(service.runtimeScript(), /navigator\.geolocation/);

console.log('micro app foundation: ok');
