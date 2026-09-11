import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MetaCloudMediaService } from '../../src/api/compat/meta-cloud/meta-cloud-media.service';

export async function runProviderNeutralMediaRegression() {
  const providerCalls: any[] = [];
  const mediaWrites: any[] = [];
  const uploads: any[] = [];

  const message = {
    id: 'db-message-1',
    key: {
      id: 'MEDIA-CANONICAL-1',
      remoteJid: '5575888888888@s.whatsapp.net',
      fromMe: false,
    },
    message: {
      documentMessage: {
        mimetype: 'application/pdf',
        fileName: 'contrato.pdf',
      },
    },
    messageType: 'documentMessage',
    Media: null,
    Instance: {
      id: 'instance-1',
      name: 'cliente01',
      integration: 'WHATSAPP-ZAPO',
      token: 'instance-token',
    },
  };

  const prisma: any = {
    message: {
      findFirst: async () => message,
    },
    instance: {
      findUnique: async () => message.Instance,
    },
    media: {
      upsert: async ({ create }: any) => {
        const record = { id: 'media-row-1', ...create };
        mediaWrites.push(record);
        return record;
      },
    },
  };

  const cache: any = {
    get: async () => null,
    set: async () => undefined,
  };

  const monitor: any = {
    waInstances: {
      cliente01: {
        getBase64FromMediaMessage: async (input: any, getBuffer: boolean) => {
          providerCalls.push({ input, getBuffer });
          return {
            buffer: Buffer.from('%PDF-provider-neutral%'),
            mediaType: 'document',
            mimetype: 'application/pdf',
            fileName: 'contrato.pdf',
          };
        },
      },
    },
  };

  const storage: any = {
    uploadFile: async (fileName: string, buffer: Buffer, size: number, metadata: Record<string, string>) => {
      uploads.push({ fileName, buffer, size, metadata });
      return { fileName };
    },
    getObjectUrl: async (fileName: string) => `https://storage.example/${fileName}`,
  };

  const service = new MetaCloudMediaService(prisma, cache, monitor, storage);
  const located = await service.locate('MEDIA-CANONICAL-1');

  // locate() happens before Graph authentication and therefore must remain
  // read-only. Provider download/storage is deferred until describe().
  assert.equal(providerCalls.length, 0);
  assert.equal(uploads.length, 0);
  assert.equal(located.id, 'MEDIA-CANONICAL-1');
  assert.equal(located.instance.name, 'cliente01');

  const described = await service.describe(located);

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].getBuffer, true);
  assert.equal(providerCalls[0].input.message.key.id, 'MEDIA-CANONICAL-1');
  assert.equal(uploads.length, 1);
  assert.equal(mediaWrites.length, 1);
  assert.equal(mediaWrites[0].messageId, 'db-message-1');
  assert.equal(mediaWrites[0].instanceId, 'instance-1');
  assert.equal(mediaWrites[0].type, 'document');
  assert.equal(mediaWrites[0].mimetype, 'application/pdf');
  assert.equal(described.id, 'MEDIA-CANONICAL-1');
  assert.equal(described.mime_type, 'application/pdf');
  assert.match(described.url, /^https:\/\/storage\.example\/meta-compat\/inbound\//);

  const source = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-media.service.ts', 'utf8');
  assert.match(source, /getBase64FromMediaMessage/);
  assert.doesNotMatch(source, /WHATSAPP-ZAPO|WHATSAPP-BAILEYS/);
}
