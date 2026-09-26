import { Events } from '@api/types/wa.types';
import { prismaJsonPath } from '@utils/prismaJsonPath';

export type PlayedReceiptKey = {
  id: string;
  remoteJid: string;
  fromMe: false;
  participant?: string;
};

export async function persistPlayedReceipt(
  prismaRepository: any,
  instanceId: string,
  key: PlayedReceiptKey,
  saveMessageUpdate: boolean,
  emit: (event: Events, data: any) => Promise<unknown> | unknown,
): Promise<{ persisted: boolean; changed: boolean }> {
  const stored = await prismaRepository.message.findFirst({
    where: {
      instanceId,
      key: { path: prismaJsonPath('id'), equals: key.id } as any,
    },
  });

  if (!stored?.id) return { persisted: false, changed: false };

  const currentStatus = String(stored.status || '').toUpperCase();
  if (currentStatus === 'PLAYED' || currentStatus === 'DELETED') {
    return { persisted: true, changed: false };
  }

  if (saveMessageUpdate) {
    const existing = await prismaRepository.messageUpdate.findFirst({
      where: {
        instanceId,
        messageId: stored.id,
        keyId: key.id,
        status: 'PLAYED',
      },
    });
    if (existing) return { persisted: true, changed: false };
  }

  await prismaRepository.message.update({
    where: { id: stored.id },
    data: { status: 'PLAYED' },
  });

  const update = {
    messageId: stored.id,
    keyId: key.id,
    remoteJid: key.remoteJid,
    fromMe: false,
    participant: key.participant,
    status: 'PLAYED',
    instanceId,
  };

  if (saveMessageUpdate) {
    await prismaRepository.messageUpdate.create({ data: update });
  }

  await emit(Events.MESSAGES_UPDATE, update);
  return { persisted: true, changed: true };
}
