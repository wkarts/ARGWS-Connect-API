import assert from 'node:assert/strict';

import {
  buildMicroAppRuntimeContext,
  candidateRemoteJids,
  interpolateRuntimeString,
  mergeRuntimeVariables,
  resolveMicroAppAutoLaunch,
} from '../../src/api/services/micro-app-auto-launch';

const policy = {
  microApps: {
    autoLaunch: {
      enabled: true,
      appKey: 'internal_demo',
      ttlSeconds: 1200,
      messageText: 'Abrir demonstração',
    },
  },
};

const launch = resolveMicroAppAutoLaunch(policy);
assert.equal(launch?.appKey, 'internal_demo');
assert.equal(launch?.ttlSeconds, 1200);
assert.equal(resolveMicroAppAutoLaunch({ microApps: { autoLaunch: { enabled: false, appKey: 'x' } } }), null);
assert.deepEqual(candidateRemoteJids('5575988881111'), [
  '5575988881111@s.whatsapp.net',
  '5575988881111@c.us',
  '5575988881111',
]);

const context = buildMicroAppRuntimeContext({
  appKey: 'internal_demo',
  url: 'https://connect.example/micro-app/token',
  expiresAt: '2026-09-03T00:00:00.000Z',
  number: '5575988881111',
  contactName: 'Cliente Teste',
  remoteJid: '5575988881111@s.whatsapp.net',
  timezone: 'America/Bahia',
  now: new Date('2026-09-03T02:15:30.000Z'),
});

assert.equal(context.contact.name, 'Cliente Teste');
assert.equal(context.contact.whatsapp, '5575988881111');
assert.equal(context.system.timezone, 'America/Bahia');
assert.equal(context.system.date, '02/09/2026');
assert.equal(context.system.time, '23:15:30');

const variables = mergeRuntimeVariables({ custom: true }, context);
assert.equal((variables as any).microApp.url, 'https://connect.example/micro-app/token');
assert.equal((variables as any).contact.name, 'Cliente Teste');
assert.equal(
  interpolateRuntimeString('Olá {{contact.name}} · {{system.dateTime}} · {{microApp.url}}', variables),
  `Olá Cliente Teste · ${context.system.dateTime} · https://connect.example/micro-app/token`,
);

console.log('micro-app auto-launch helpers: ok');
