import assert from 'node:assert/strict';

import { MetaCloudAuthService } from '../../src/api/compat/meta-cloud/meta-cloud-auth.service';
import { MetaCloudGraphController } from '../../src/api/compat/meta-cloud/meta-cloud-graph.controller';
import { MetaCloudIdentityResolver } from '../../src/api/compat/meta-cloud/meta-cloud-identity.resolver';
import { MetaCloudTemplateService } from '../../src/api/compat/meta-cloud/meta-cloud-template.service';
import { MetaCloudGraphError } from '../../src/api/compat/meta-cloud/meta-cloud.error';

const phone = '5575999999999';
const oldInstance = {
  id: 'old-instance',
  name: 'old-baileys',
  integration: 'WHATSAPP-BAILEYS',
  number: phone,
  token: 'old-instance-token',
  connectionStatus: 'close',
};
const hubInstance = {
  ...oldInstance,
  id: 'hub-instance',
  name: 'hub-zapo',
  integration: 'WHATSAPP-ZAPO',
  token: 'hub-instance-token',
  connectionStatus: 'open',
};
const otherInstance = {
  ...hubInstance,
  id: 'other-instance',
  name: 'other-zapo',
  number: '5511888888888',
  token: 'other-instance-token',
};

function setup(records: any[] = [oldInstance, hubInstance, otherInstance]) {
  const calls: { operation: string; instanceName: string }[] = [];
  const resolver = new MetaCloudIdentityResolver({
    instance: { findMany: async () => records },
  } as any);
  const auth = new MetaCloudAuthService(() => 'installation-secret');
  const templates = new MetaCloudTemplateService({
    findTemplate: async (identity: any) => {
      calls.push({ operation: 'templates', instanceName: identity.instanceName });
      return { data: [{ name: 'actual-template', language: 'pt_BR', components: [] }] };
    },
  } as any, { list: async () => ({ data: [] }) } as any);
  const controller = new MetaCloudGraphController(
    resolver,
    auth,
    {
      execute: async (identity: any) => {
        calls.push({ operation: 'send', instanceName: identity.instanceName });
        return { messages: [{ id: 'REAL_PROVIDER_ID' }] };
      },
    } as any,
    {
      upload: async (identity: any) => {
        calls.push({ operation: 'upload', instanceName: identity.instanceName });
        return { id: 'REAL_MEDIA_ID' };
      },
      locate: async () => ({ instance: hubInstance }),
      describe: async () => ({ id: 'REAL_MEDIA_ID' }),
    } as any,
    templates,
  );
  return { resolver, controller, calls };
}

function oauthError(error: unknown): boolean {
  return error instanceof MetaCloudGraphError && error.httpStatus === 401 && error.graphCode === 190;
}

function notFound(error: unknown): boolean {
  return error instanceof MetaCloudGraphError && error.httpStatus === 404;
}

export async function runGraphIdentityRoutingRegression() {
  let passed = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    await run();
    passed += 1;
    console.log(`graph identity routing: ok ${passed} - ${name}`);
  };

  await check('HUB template sync accepts the second instance token for a shared number', async () => {
    const { controller, calls } = setup();
    assert.deepEqual(await controller.listTemplates('v14.0', phone, 'Bearer hub-instance-token'), { data: [] });
    assert.deepEqual(calls, []); // Authorization-only fixture: local list is mocked empty; template feature has separate coverage.
  });

  await check('phone and business IDs prefer the matching instance token', async () => {
    const { resolver } = setup();
    assert.equal((await resolver.resolveByPhoneNumberId(phone, hubInstance.token)).instanceId, hubInstance.id);
    assert.equal((await resolver.resolveByBusinessAccountId(phone, hubInstance.token)).instanceId, hubInstance.id);
  });

  for (const records of [
    [oldInstance, hubInstance],
    [hubInstance, oldInstance],
  ]) {
    await check(`send and upload stay scoped with ${records[0].name} first`, async () => {
      const { controller, calls } = setup(records);
      const authorization = 'Bearer hub-instance-token';
      assert.deepEqual(await controller.send('v20.0', phone, authorization, { type: 'text' }), {
        messages: [{ id: 'REAL_PROVIDER_ID' }],
      });
      assert.deepEqual(await controller.upload('v20.0', phone, authorization, {}), { id: 'REAL_MEDIA_ID' });
      assert.deepEqual(calls, [
        { operation: 'send', instanceName: hubInstance.name },
        { operation: 'upload', instanceName: hubInstance.name },
      ]);
      assert.deepEqual(await controller.listTemplates('v20.0', phone, 'Bearer old-instance-token'), { data: [] });
    });
  }

  for (const authorization of [
    undefined,
    '',
    'Bearer ',
    'Basic hub-instance-token',
    'Bearer invalid-token',
    'Bearer other-instance-token',
  ]) {
    await check(`invalid or unrelated credential is rejected (${passed + 1})`, async () => {
      const { controller, calls } = setup();
      await assert.rejects(controller.listTemplates('v20.0', phone, authorization), oauthError);
      await assert.rejects(controller.send('v20.0', phone, authorization, { type: 'text' }), oauthError);
      await assert.rejects(controller.upload('v20.0', phone, authorization, {}), oauthError);
      assert.deepEqual(calls, []);
    });
  }

  for (const authorization of [
    'bearer hub-instance-token',
    'Bearer   hub-instance-token  ',
    ['Bearer hub-instance-token', 'Bearer old-instance-token'],
  ]) {
    await check(`existing Bearer parsing is preserved (${passed + 1})`, async () => {
      const { controller } = setup();
      assert.deepEqual(await controller.listTemplates('v20.0', phone, authorization), { data: [] });
    });
  }

  await check('the token cannot select an instance belonging to a different Graph object', async () => {
    const { resolver, controller } = setup();
    assert.equal((await resolver.resolveByPhoneNumberId(phone, otherInstance.token)).instanceId, oldInstance.id);
    assert.equal((await resolver.resolveByBusinessAccountId(phone, otherInstance.token)).instanceId, oldInstance.id);
    await assert.rejects(
      controller.listTemplates('v20.0', otherInstance.number, 'Bearer hub-instance-token'),
      oauthError,
    );
  });

  await check('missing Graph objects still return 404', async () => {
    const { controller } = setup();
    await assert.rejects(controller.listTemplates('v20.0', 'missing-waba', 'Bearer hub-instance-token'), notFound);
    await assert.rejects(controller.send('v20.0', '5575000000000', 'Bearer hub-instance-token', {}), notFound);
    await assert.rejects(controller.send('v20.0', 'invalid', 'Bearer hub-instance-token', {}), notFound);
  });

  await check('calls without a token hint keep the previous first-match behavior', async () => {
    const { resolver } = setup();
    assert.equal((await resolver.resolveByPhoneNumberId(phone)).instanceId, oldInstance.id);
    assert.equal((await resolver.resolveByBusinessAccountId(phone)).instanceId, oldInstance.id);
  });

  await check('the existing administrative Bearer policy is unchanged', async () => {
    const { controller, calls } = setup();
    assert.deepEqual(await controller.listTemplates('v20.0', phone, 'Bearer installation-secret'), { data: [] });
    await controller.send('v20.0', phone, 'Bearer installation-secret', {});
    assert.deepEqual(calls, [{ operation: 'send', instanceName: oldInstance.name }]);
  });

  await check('invalid identities and missing candidate tokens do not mask a valid instance', async () => {
    const { controller } = setup([
      { id: 'unpaired', name: 'unpaired', integration: 'WHATSAPP-ZAPO' },
      { ...oldInstance, token: undefined },
      hubInstance,
    ]);
    assert.deepEqual(await controller.listTemplates('v20.0', phone, 'Bearer hub-instance-token'), { data: [] });
  });

  await check('ownerJid fallback and normalized phone lookup remain supported', async () => {
    const { resolver, controller } = setup([
      oldInstance,
      { ...hubInstance, number: undefined, ownerJid: `${phone}@s.whatsapp.net` },
    ]);
    assert.equal(
      (await resolver.resolveByPhoneNumberId('+55 (75) 99999-9999', hubInstance.token)).instanceId,
      hubInstance.id,
    );
    assert.deepEqual(await controller.listTemplates('v20.0', phone, 'Bearer hub-instance-token'), { data: [] });
  });

  await check('connection state does not override a matching instance credential', async () => {
    const { resolver } = setup([
      { ...oldInstance, connectionStatus: 'open' },
      { ...hubInstance, connectionStatus: 'close' },
    ]);
    assert.equal((await resolver.resolveByPhoneNumberId(phone, hubInstance.token)).instanceId, hubInstance.id);
  });

  await check('official WABA templates are delegated to the authenticated instance', async () => {
    const businessA = { ...oldInstance, integration: 'WHATSAPP-BUSINESS', businessId: 'waba-fixture' };
    const businessB = { ...otherInstance, integration: 'WHATSAPP-BUSINESS', businessId: 'waba-fixture' };
    const { controller, calls } = setup([businessA, businessB]);
    assert.deepEqual(await controller.listTemplates('v20.0', 'waba-fixture', 'Bearer other-instance-token'), {
      data: [{ name: 'actual-template', language: 'pt_BR', components: [] }],
    });
    assert.deepEqual(calls, [{ operation: 'templates', instanceName: otherInstance.name }]);
    await assert.rejects(controller.listTemplates('v20.0', 'waba-fixture', 'Bearer invalid-token'), oauthError);
    assert.equal(calls.length, 1);
  });

  await check('media descriptor authorization stays tied to its located instance', async () => {
    const { controller } = setup();
    assert.deepEqual(await controller.getMedia('v20.0', 'REAL_MEDIA_ID', 'Bearer hub-instance-token'), {
      id: 'REAL_MEDIA_ID',
    });
    await assert.rejects(controller.getMedia('v20.0', 'REAL_MEDIA_ID', 'Bearer old-instance-token'), oauthError);
  });

  console.log(`graph identity routing: ${passed} scenarios passed`);
}
