import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

import { DEFAULT_HELLO_TEXT, defaultLocalTemplateRecord } from '../src/api/services/local-template.definition';
import { LocalTemplateService } from '../src/api/services/local-template.service';

async function main() {
  // This suite creates fixtures and replays seed SQL. Never run on a real account DB.
  if (process.env.CI !== 'true' || !process.env.DATABASE_CONNECTION_URI?.includes('/argws_connect_test')) {
    throw new Error('This test requires CI=true and the isolated argws_connect_test database.');
  }
  const prisma = new PrismaClient();
  const prefix = `template-test-${randomUUID()}`;
  const ids = ['zapo', 'baileys', 'business', 'new'].map((suffix) => `${prefix}-${suffix}`);
  const local = new LocalTemplateService(prisma as any);
  try {
    for (const [index, integration] of ['WHATSAPP-ZAPO', 'WHATSAPP-BAILEYS', 'WHATSAPP-BUSINESS'].entries()) {
      await prisma.instance.create({ data: { id: ids[index], name: ids[index], integration, token: `test-${index}` } });
    }
    const provider = process.env.DATABASE_PROVIDER === 'mysql' ? 'mysql' : 'postgresql';
    const migration = fs.readFileSync(`prisma/${provider}-migrations/20260911200000_local_templates/migration.sql`, 'utf8');
    const seed = migration.slice(migration.indexOf('INSERT INTO'));
    await prisma.$executeRawUnsafe(seed);
    await prisma.$executeRawUnsafe(seed);
    for (const id of ids.slice(0, 2)) {
      const records = await prisma.localTemplate.findMany({ where: { instanceId: id } });
      assert.equal(records.length, 1, 'seed is idempotent and per instance');
      assert.equal(records[0].name, 'hello');
      assert.equal((await local.render(id, { name: 'hello', language: 'pt_BR' })).text, DEFAULT_HELLO_TEXT);
    }
    assert.equal(await prisma.localTemplate.count({ where: { instanceId: ids[2] } }), 0);
    // New-instance creation uses the same nested factory as monitor.saveInstance.
    await prisma.instance.create({ data: { id: ids[3], name: ids[3], integration: 'WHATSAPP-ZAPO', LocalTemplate: { create: defaultLocalTemplateRecord() } } });
    assert.equal((await local.list(ids[3])).data.length, 1);
    const hello = { name: 'hello', language: 'pt_BR', version: 1 };
    await local.edit(ids[0], { ...hello, enabled: false });
    await assert.rejects(local.edit(ids[0], { ...hello, enabled: true }), (e: any) => e.status === 409);
    await assert.rejects(local.render(ids[0], hello), (e: any) => e.status === 409);
    await prisma.$executeRawUnsafe(seed);
    assert.equal((await local.list(ids[0])).data[0].enabled, false, 'seed does not overwrite administrator choice');
    await local.archive(ids[0], { ...hello, version: 2 });
    await prisma.$executeRawUnsafe(seed);
    assert.equal((await local.list(ids[0])).data.length, 0, 'seed and reads do not resurrect archived hello');
    assert.equal((await local.list(ids[1])).data.length, 1, 'other instance remains intact');
    // Composite unique permits same name in independent languages/instances.
    for (const id of ids.slice(0, 2)) await local.create(id, { name: 'notice', language: 'pt_BR', components: [{ type: 'BODY', text: 'Olá {{1}}' }] });
    await local.create(ids[0], { name: 'notice', language: 'en_US', components: [{ type: 'BODY', text: 'Hello {{1}}' }] });
    await assert.rejects(local.create(ids[0], { name: 'notice', language: 'pt_BR', components: [{ type: 'BODY', text: 'duplicate' }] }), (e: any) => e.status === 409);
    const updates = await Promise.allSettled([true, false].map((enabled) => local.edit(ids[0], { name: 'notice', language: 'pt_BR', version: 1, enabled })));
    assert.equal(updates.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one concurrent revision wins');
    await prisma.instance.delete({ where: { id: ids[3] } });
    assert.equal(await prisma.localTemplate.count({ where: { instanceId: ids[3] } }), 0, 'instance deletion cascades to local catalog');
    console.log(`local templates real database (${provider}): migration seed, CRUD, isolation, optimistic race and cascade OK`);
  } finally {
    await prisma.instance.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
}
void main();
