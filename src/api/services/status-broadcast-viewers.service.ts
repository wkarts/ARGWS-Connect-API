import { prismaJsonPath } from '@utils/prismaJsonPath';

export const STATUS_BROADCAST_JID = 'status@broadcast';

export type StatusViewerReceipt = {
  statusId: string;
  participant: string;
  status: 'VIEWED';
};

/**
 * Only a read/play receipt for an outgoing story proves that a contact viewed
 * it. Delivery receipts are deliberately excluded from the viewer list.
 */
export function extractStatusViewerReceipt(event: any): StatusViewerReceipt | null {
  const key = event?.key && typeof event.key === 'object' ? event.key : {};
  const receipt = event?.receipt && typeof event.receipt === 'object' ? event.receipt : {};
  const statusId = String(key.id || '').trim();
  const participant = String(receipt.userJid || receipt.participant || key.participant || '').trim();
  const read = Number(receipt.readTimestamp) > 0 || Number(receipt.playedTimestamp) > 0;
  if (key.remoteJid !== STATUS_BROADCAST_JID || key.fromMe !== true || !statusId || !participant || !read) return null;
  return { statusId, participant, status: 'VIEWED' };
}

export async function recordStatusViewerReceipt(repository: any, instanceId: string, event: any): Promise<boolean> {
  const viewer = extractStatusViewerReceipt(event);
  if (!viewer) return false;
  const statusMessage = await repository.message.findFirst({
    where: {
      instanceId,
      status: { not: 'DELETED' },
      AND: [
        { key: { path: prismaJsonPath('id'), equals: viewer.statusId } },
        { key: { path: prismaJsonPath('remoteJid'), equals: STATUS_BROADCAST_JID } },
        { key: { path: prismaJsonPath('fromMe'), equals: true } },
      ],
    },
    select: { id: true },
  });
  if (!statusMessage) return false;

  const where = {
    instanceId,
    messageId: statusMessage.id,
    keyId: viewer.statusId,
    remoteJid: STATUS_BROADCAST_JID,
    fromMe: true,
    participant: viewer.participant,
    status: viewer.status,
  };
  const existing = await repository.messageUpdate.findFirst({ where, select: { id: true } });
  if (existing) return false;
  await repository.messageUpdate.create({ data: where });
  return true;
}

export async function listStatusViewers(repository: any, instanceId: string, statusId: string) {
  const id = String(statusId || '').trim();
  if (!id) return null;
  const message = await repository.message.findFirst({
    where: {
      instanceId,
      status: { not: 'DELETED' },
      AND: [
        { key: { path: prismaJsonPath('id'), equals: id } },
        { key: { path: prismaJsonPath('remoteJid'), equals: STATUS_BROADCAST_JID } },
        { key: { path: prismaJsonPath('fromMe'), equals: true } },
      ],
    },
    select: { id: true },
  });
  if (!message) return null;

  const rows = await repository.messageUpdate.findMany({
    where: {
      instanceId,
      messageId: message.id,
      keyId: id,
      remoteJid: STATUS_BROADCAST_JID,
      fromMe: true,
      status: 'VIEWED',
      participant: { not: null },
    },
    select: { participant: true, status: true },
    orderBy: { id: 'asc' },
  });
  const viewers = new Map<string, { participant: string; status: 'VIEWED' }>();
  for (const row of rows) {
    const participant = String(row?.participant || '').trim();
    if (participant) viewers.set(participant, { participant, status: 'VIEWED' });
  }
  return { id, count: viewers.size, viewers: [...viewers.values()] };
}
