import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MetaCloudAuthService } from '../src/api/compat/meta-cloud/meta-cloud-auth.service';
import { MetaCloudGraphController } from '../src/api/compat/meta-cloud/meta-cloud-graph.controller';
import { MetaCloudIdentityResolver } from '../src/api/compat/meta-cloud/meta-cloud-identity.resolver';
import { MetaCloudMessageAdapter } from '../src/api/compat/meta-cloud/meta-cloud-message.adapter';
import { MetaCloudResponseSerializer } from '../src/api/compat/meta-cloud/meta-cloud-response.serializer';
import { MetaCloudTemplateService } from '../src/api/compat/meta-cloud/meta-cloud-template.service';
import { SendMessageController } from '../src/api/controllers/sendMessage.controller';
import {
  defaultLocalTemplateRecord,
  DEFAULT_HELLO_TEXT,
  LocalTemplateError,
  renderLocalTemplate,
  validateTemplateComponents,
  validateTemplateCreate,
} from '../src/api/services/local-template.definition';
import { LocalTemplateService } from '../src/api/services/local-template.service';

// Stateful repository double. It actually retains mutations and enforces the
// scoped unique key; no provider, HTTP or production database is contacted.
function repository() {
  const instances = [
    { id: 'a', name: 'local-a', integration: 'WHATSAPP-ZAPO', number: '5511999999999', token: 'a-token' },
    { id: 'b', name: 'local-b', integration: 'WHATSAPP-BAILEYS', number: '5511999999999', token: 'b-token' },
    { id: 'c', name: 'official', integration: 'WHATSAPP-BUSINESS', number: '123456789', businessId: 'waba', token: 'meta-token' },
  ];
  const rows: any[] = [];
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object') return value.gt ? row[key] > value.gt : false;
    return row[key] === value;
  });
  const table = {
    async create({ data }: any) {
      if (rows.some((row) => ['instanceId', 'name', 'language'].every((key) => row[key] === data[key]))) {
        throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      }
      const row = { enabled: true, version: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return structuredClone(row);
    },
    async findMany({ where, take }: any) {
      assert.equal(typeof where.instanceId, 'string', 'all lists must be instance scoped');
      return structuredClone(rows.filter((row) => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take));
    },
    async findUnique({ where }: any) {
      const scoped = where.instanceId_name_language;
      assert.ok(scoped.instanceId, 'identity must include instance');
      return structuredClone(rows.find((row) => matches(row, scoped)) || null);
    },
    async updateMany({ where, data }: any) {
      assert.ok(where.instanceId && where.version, 'mutations require instance and version');
      let count = 0;
      rows.filter((row) => matches(row, where)).forEach((row) => {
        Object.assign(row, { ...data, version: row.version + data.version.increment, updatedAt: new Date() });
        count++;
      });
      return { count };
    },
  };
  const db: any = {
    localTemplate: table,
    instance: {
      findUnique: async ({ where }: any) => instances.find((item) => item.name === where.name) || null,
      findMany: async () => instances,
    },
    $transaction: async (run: any) => run(db),
  };
  return { db, rows, instances };
}

const body = (text: string) => [{ type: 'BODY', text }];
const errorStatus = (status: number) => (error: any) => error instanceof LocalTemplateError && error.status === status;
const args = (name = 'hello', components: any = []) => ({ name, language: 'pt_BR', components });

export async function runLocalTemplateRegression() {
  let passed = 0;
  const check = async (label: string, run: () => any) => {
    await run();
    console.log(`local templates: ok ${++passed} - ${label}`);
  };
  const { db, rows, instances } = repository();
  const local = new LocalTemplateService(db);
  await check('catalog read has no seeding or writes', async () => {
    assert.deepEqual((await local.list('local-a')).data, []);
    assert.equal(rows.length, 0);
  });
  await check('real persisted hello for each local instance', async () => {
    for (const instanceId of ['a', 'b']) await db.localTemplate.create({ data: { ...defaultLocalTemplateRecord(), instanceId } });
    const a = (await local.list('local-a')).data[0];
    const b = (await local.list('local-b')).data[0];
    assert.notEqual(a.id, b.id);
    assert.equal(a.components[0].text, DEFAULT_HELLO_TEXT);
    assert.equal(a.source, 'connectapi_local');
    assert.equal(a.execution, 'rendered_text');
    assert.equal(a.status, 'LOCAL_READY');
    assert.equal(a.meta_approved, false);
    assert.equal((await local.render('local-a', args())).text, DEFAULT_HELLO_TEXT);
  });
  await check('same name in different instances and languages, no global unique collision', async () => {
    for (const instance of ['local-a', 'local-b']) {
      await local.create(instance, { name: 'notice', language: 'pt_BR', components: body('Oi {{1}}') });
    }
    await local.create('local-a', { name: 'notice', language: 'en_US', components: body('Hi {{1}}') });
    await assert.rejects(local.create('local-a', { name: 'notice', language: 'pt_BR', components: body('duplicate') }), errorStatus(409));
    assert.equal((await local.list('local-a')).data.length, 3);
    assert.equal((await local.list('local-b')).data.length, 2);
  });
  await check('foreign instance and provider are not accessible through catalog service', async () => {
    await assert.rejects(local.list('missing'), errorStatus(404));
    await assert.rejects(local.list('official'), errorStatus(400));
    await local.create('local-a', { name: 'private_a', language: 'pt_BR', components: body('A only') });
    await assert.rejects(local.render('local-b', args('private_a')), errorStatus(404));
    await assert.rejects(local.edit('local-b', { name: 'private_a', language: 'pt_BR', version: 1, enabled: false }), errorStatus(409));
  });
  await check('pagination is bounded, relative and stays instance scoped', async () => {
    let query: any = { limit: '1' };
    const all: any[] = [];
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await local.list('local-a', query);
      all.push(...page.data);
      if (!page.paging) break;
      assert.ok(page.paging.next.startsWith('?after='));
      query = Object.fromEntries(new URLSearchParams(page.paging.next.slice(1)));
    }
    assert.equal(all.length, 4);
    assert.equal(new Set(all.map((item) => item.id)).size, 4);
    for (const limit of [0, 101, -1, 'x', ['2'], 1.1]) await assert.rejects(local.list('local-a', { limit }), errorStatus(400));
    await assert.rejects(local.list('local-a', { after: 'not-a-cursor' }), errorStatus(400));
  });
  await check('definition validates fields, formats and consecutive variables', () => {
    for (const components of [[], body(''), body('{{0}}'), body('{{2}}'), body('{{01}}'), body('{{name}}'), body('{{99999999999}}'), body('x'.repeat(4097)), [{ type: 'BUTTONS', text: 'a' }], [{ type: 'BODY', text: 'ok', format: 'IMAGE' }], [...body('a'), ...body('b')], [{ type: 'HEADER', text: '{{1}}' }, ...body('a')]]) {
      assert.throws(() => validateTemplateComponents(components), LocalTemplateError);
    }
    for (const input of [{ name: 'Hello', language: 'pt_BR' }, { name: 'hello', language: '../../' }, { name: 'hello', language: 'pt_BR', enabled: 'true' }, { name: 'hello', language: 'pt_BR', source: 'official' }]) {
      assert.throws(() => validateTemplateCreate({ ...input, components: body('a') }), LocalTemplateError);
    }
  });
  await check('render placeholders only once, repeat positions, full static header/body/footer', () => {
    const definition = [{ type: 'FOOTER', text: 'Equipe' }, ...body('Olá {{1}}, código {{2}} — {{1}}'), { type: 'HEADER', format: 'TEXT', text: 'Atendimento' }];
    const text = renderLocalTemplate(definition, [{ type: 'body', parameters: [{ type: 'text', text: '{{2}}' }, { type: 'text', text: '$&' }] }]);
    assert.equal(text, 'Atendimento\n\nOlá {{2}}, código $& — {{2}}\n\nEquipe');
  });
  await check('parameter arity, type, duplicate components and payload limits are enforced', () => {
    for (const params of [null, {}, [], [{ type: 'body', parameters: [] }], [{ type: 'body', parameters: [{ type: 'text', text: ' ' }] }], [{ type: 'body', parameters: [{ type: 'image', text: 'a' }] }], [{ type: 'body', parameters: [{ type: 'text', text: 'x'.repeat(1025) }] }], [{ type: 'body', parameters: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }], [{ type: 'body', parameters: [] }, { type: 'body', parameters: [] }]]) {
      assert.throws(() => renderLocalTemplate(body('Oi {{1}}'), params), LocalTemplateError);
    }
    assert.throws(() => renderLocalTemplate(body(('{{1}} ').repeat(700)), [{ type: 'body', parameters: [{ type: 'text', text: 'x'.repeat(20) }] }]), LocalTemplateError);
  });
  await check('optimistic edits reject stale versions, immutable identity, no arbitrary caller text', async () => {
    const edited = await local.edit('local-a', { name: 'hello', language: 'pt_BR', version: 1, components: body('Olá do cadastro A') });
    assert.equal(edited.version, 2);
    await assert.rejects(local.edit('local-a', { name: 'hello', language: 'pt_BR', version: 1, enabled: false }), errorStatus(409));
    await assert.rejects(local.render('local-a', { ...args(), version: 1 }), errorStatus(409));
    const rendered = await local.render('local-a', { ...args(), version: 2, text: 'injected arbitrary body' } as any);
    assert.equal(rendered.text, 'Olá do cadastro A');
    assert.equal((await local.render('local-b', args())).text, DEFAULT_HELLO_TEXT);
  });
  await check('disabled models cannot execute; reads do not enable them', async () => {
    await local.edit('local-a', { name: 'hello', language: 'pt_BR', version: 2, enabled: false });
    assert.equal((await local.list('local-a')).data.find((item) => item.name === 'hello')?.status, 'LOCAL_DISABLED');
    await assert.rejects(local.render('local-a', args()), errorStatus(409));
    await local.edit('local-a', { name: 'hello', language: 'pt_BR', version: 3, enabled: true });
  });
  await check('archiving hello leaves its tombstone, no recreation or cross-instance loss', async () => {
    await local.archive('local-a', { name: 'hello', language: 'pt_BR', version: 4 });
    assert.equal((await local.list('local-a')).data.some((item) => item.name === 'hello'), false);
    await assert.rejects(local.render('local-a', args()), errorStatus(404));
    await assert.rejects(local.create('local-a', { name: 'hello', language: 'pt_BR', components: body('recreate') }), errorStatus(409));
    assert.equal((await local.render('local-b', args())).text, DEFAULT_HELLO_TEXT);
  });

  const sends: any[] = [];
  const monitor: any = { waInstances: {
    'local-a': { integration: 'WHATSAPP-ZAPO', connectionStatus: { state: 'open' }, textMessage: async (data: any) => { sends.push(data); return { key: { id: 'REAL_ZAPO_ID' } }; } },
    'local-b': { integration: 'WHATSAPP-BAILEYS', connectionStatus: { state: 'open' }, textMessage: async (data: any) => { sends.push(data); return { key: { id: 'REAL_BAILEYS_ID' } }; } },
    official: { integration: 'WHATSAPP-BUSINESS', connectionStatus: { state: 'open' }, templateMessage: async (data: any) => { sends.push(data); return { messages: [{ id: 'OFFICIAL_PROVIDER_ID' }] }; } },
  } };
  const sender = new SendMessageController(monitor, local);
  const adapter = new MetaCloudMessageAdapter(sender, {} as any, db, monitor, {} as any, new MetaCloudResponseSerializer());
  const resolver = new MetaCloudIdentityResolver(db);
  const templates = new MetaCloudTemplateService({ findTemplate: async () => ({ data: [{ name: 'official', status: 'APPROVED' }] }) } as any, local);
  const controller = new MetaCloudGraphController(resolver, new MetaCloudAuthService(() => 'admin-test'), adapter, {} as any, templates);
  await check('Graph listing matches second instance token for same phone (PR94)', async () => {
    const page = await controller.listTemplates('v14.0', instances[1].number!, 'Bearer b-token');
    assert.ok(page.data.some((item: any) => item.name === 'hello'));
    await assert.rejects(controller.listTemplates('v14.0', instances[1].number!, 'Bearer invalid'), (e: any) => e.httpStatus === 401);
  });
  await check('Graph executes persisted Baileys hello once with no parameters, real ID and explicit provenance', async () => {
    const result = await controller.send('v20.0', instances[1].number!, 'Bearer b-token', {
      to: '5511888888888', type: 'template', template: { name: 'hello', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [] }], connect_api_version: 1 },
    });
    assert.equal(result.messages[0].id, 'REAL_BAILEYS_ID');
    assert.equal(result.connect_api.template.source, 'connectapi_local');
    assert.equal(result.connect_api.template.meta_approved, false);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].text, DEFAULT_HELLO_TEXT);
  });
  await check('native ZAPO template renders exact stored content and parameter before send', async () => {
    const result = await sender.sendTemplate({ instanceName: 'local-a' }, { ...args('notice', [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }] }]), number: '5511888888888', version: 1 } as any);
    assert.equal(result.key.id, 'REAL_ZAPO_ID');
    assert.equal(sends.length, 2);
    assert.equal(sends[1].text, 'Oi Maria');
  });
  await check('invalid/stale/archived templates and disconnected instance never fall back or send', async () => {
    const previous = sends.length;
    await assert.rejects(sender.sendTemplate({ instanceName: 'local-a' }, { ...args(), number: '5511888888888' } as any), errorStatus(404));
    await assert.rejects(sender.sendTemplate({ instanceName: 'local-b' }, { ...args(), number: '5511888888888', version: 20 } as any), errorStatus(409));
    monitor.waInstances['local-b'].connectionStatus.state = 'close';
    await assert.rejects(sender.sendTemplate({ instanceName: 'local-b' }, { ...args(), number: '5511888888888' } as any), errorStatus(409));
    monitor.waInstances['local-b'].connectionStatus.state = 'open';
    assert.equal(sends.length, previous);
  });
  await check('native local send without provider ID is not a confirmed success', async () => {
    const previous = monitor.waInstances['local-b'].textMessage;
    monitor.waInstances['local-b'].textMessage = async () => ({});
    await assert.rejects(sender.sendTemplate({ instanceName: 'local-b' }, { ...args(), number: '5511888888888' } as any), errorStatus(500));
    monitor.waInstances['local-b'].textMessage = previous;
  });
  await check('Graph rejects missing template identity before any send', async () => {
    const previous = sends.length;
    await assert.rejects(controller.send('v20.0', instances[1].number!, 'Bearer b-token', { to: '5511888888888', type: 'template' }), (e: any) => e.httpStatus === 400);
    assert.equal(sends.length, previous);
  });
  await check('official catalog and native Business template path are preserved', async () => {
    assert.deepEqual(await controller.listTemplates('v20.0', 'waba', 'Bearer meta-token'), { data: [{ name: 'official', status: 'APPROVED' }] });
    const result = await controller.send('v20.0', '123456789', 'Bearer meta-token', {
      to: '5511888888888', type: 'template', template: { name: 'approved_remote', language: { code: 'pt_BR' }, components: [] },
    });
    assert.equal(result.messages[0].id, 'OFFICIAL_PROVIDER_ID');
    assert.equal(result.connect_api, undefined);
    assert.equal(sends.at(-1).name, 'approved_remote');
    assert.equal(sends.at(-1).text, undefined);
    assert.deepEqual(sends.at(-1).language, { code: 'pt_BR' });
  });
  await check('native template routes preserve authorized path identity and official table schema', () => {
    const routes = fs.readFileSync('src/api/routes/local-template.router.ts', 'utf8');
    assert.doesNotMatch(routes, /dataValidate|\.\.\.req\.(body|query)/);
    assert.match(routes, /localTemplateService\.create\(req\.params\.instanceName, req\.body\)/);
    const sendRoute = fs.readFileSync('src/api/routes/sendMessage.router.ts', 'utf8');
    assert.match(sendRoute, /const instanceName = req\.params\.instanceName/);
    assert.match(sendRoute, /sendMessageController\.sendTemplate\(\{ instanceName \}, data\)/);
    const migration = fs.readFileSync('prisma/postgresql-migrations/20260911200000_local_templates/migration.sql', 'utf8');
    assert.doesNotMatch(migration, /ALTER TABLE "Template"|UPDATE "Template"|DELETE FROM "Template"/);
    const monitorSource = fs.readFileSync('src/api/services/monitor.service.ts', 'utf8');
    assert.match(monitorSource, /create: defaultLocalTemplateRecord\(\)/);
  });
  console.log(`local templates: ${passed} scenarios passed`);
}
