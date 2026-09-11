import assert from 'node:assert/strict';
import fs from 'node:fs';

import { materializeProviderMedia } from '../../src/api/compat/meta-cloud/meta-cloud-media.materializer';

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
    Instance: {
      id: 'instance-1',
      name: 'cliente01',
    },
  };

  const provider = {
    getBase64FromMediaMessage: async (input: any, getBuffer: boolean) => {
      providerCalls.push({ input, getBuffer });
      return {
        buffer: Buffer.from('%PDF-provider-neutral%'),
        mediaType: 'document',
        mimetype: 'application/pdf',
        fileName: 'contrato.pdf',
      };
    },
  };

  const storage = {
    uploadFile: async (fileName: string, buffer: Buffer, size: number, metadata: Record<string, string>) => {
      uploads.push({ fileName, buffer, size, metadata });
      return { fileName };
    },
    getObjectUrl: async (fileName: string) => `https://storage.example/${fileName}`,
  };

  const materialized = await materializeProviderMedia({
    mediaId: 'MEDIA-CANONICAL-1',
    message,
    provider,
    storage,
    persist: async (record) => {
      const persisted = { id: 'media-row-1', messageId: message.id, ...record };
      mediaWrites.push(persisted);
      return persisted;
    },
  });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].getBuffer, true);
  assert.equal(providerCalls[0].input.message.key.id, 'MEDIA-CANONICAL-1');
  assert.equal(uploads.length, 1);
  assert.equal(mediaWrites.length, 1);
  assert.equal(mediaWrites[0].messageId, 'db-message-1');
  assert.equal(mediaWrites[0].instanceId, 'instance-1');
  assert.equal(mediaWrites[0].type, 'document');
  assert.equal(mediaWrites[0].mimetype, 'application/pdf');
  assert.equal(materialized.fileName, mediaWrites[0].fileName);
  assert.match(materialized.fileName, /^meta-compat\/inbound\/instance-1\/MEDIA-CANONICAL-1\//);

  const serviceSource = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-media.service.ts', 'utf8');
  const materializerSource = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-media.materializer.ts', 'utf8');
  assert.match(serviceSource, /materializeProviderMedia/);
  assert.doesNotMatch(serviceSource, /WHATSAPP-ZAPO|WHATSAPP-BAILEYS/);
  assert.doesNotMatch(materializerSource, /WHATSAPP-ZAPO|WHATSAPP-BAILEYS/);

  // locate() is executed before Graph authorization. It may identify the
  // Message/Instance, but the actual provider download must remain in describe().
  const locateBody = serviceSource.slice(
    serviceSource.indexOf('public async locate'),
    serviceSource.indexOf('public async describe'),
  );
  assert.doesNotMatch(locateBody, /materializeProviderMedia|getBase64FromMediaMessage|uploadFile/);
}
