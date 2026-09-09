import { getCatalogDto, getCollectionsDto } from '@api/dto/business.dto';
import { BadRequestException, InternalServerErrorException } from '@exceptions';

import type { createCatalogReader } from './zapo.catalog.plugin';

type Host = {
  client: { connectCatalog?: ReturnType<typeof createCatalogReader>; getCredentials: () => { meJid?: string } };
  connectionStatus: { state?: string };
  whatsappNumber: (data: { numbers: string[] }) => Promise<any[]>;
  fetchBusinessProfile: (number?: string) => Promise<any>;
};
async function owner(host: Host, number?: string) {
  if (host.connectionStatus.state !== 'open' || !host.client?.connectCatalog) {
    throw new BadRequestException('A conexão WhatsApp precisa estar ativa para consultar o catálogo.');
  }
  const candidate = number || host.client.getCredentials()?.meJid;
  if (!candidate || /@(g\.us|broadcast|newsletter)$/.test(candidate)) {
    throw new BadRequestException('Informe o contato proprietário do catálogo.');
  }
  const info = (await host.whatsappNumber({ numbers: [candidate] }))[0];
  if (!info?.exists) throw new BadRequestException('Contato não encontrado no WhatsApp.');
  return info;
}
function pageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit deve estar entre 1 e 100.');
  return limit;
}
export async function readZapoCatalog(host: Host, data: getCatalogDto) {
  const info = await owner(host, data.number);
  const limit = pageLimit(data.limit ?? 10);
  const maxPages = data.maxPages ?? (data.cursor ? 1 : 5);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) {
    throw new BadRequestException('maxPages deve estar entre 1 e 20.');
  }
  if (data.cursor !== undefined && (typeof data.cursor !== 'string' || data.cursor.length > 4096)) {
    throw new BadRequestException('Cursor de catálogo inválido.');
  }
  try {
    const products = new Map<string, any>();
    const cursors = new Set<string>();
    let nextPageCursor = data.cursor || undefined;
    for (let page = 0; page < maxPages; page++) {
      if (nextPageCursor) {
        if (cursors.has(nextPageCursor)) throw new Error('Repeated catalog cursor');
        cursors.add(nextPageCursor);
      }
      const result = await host.client.connectCatalog!.getCatalog({ jid: info.jid, limit, cursor: nextPageCursor });
      for (const product of result.products) products.set(product.id, product);
      nextPageCursor = result.nextPageCursor;
      if (!nextPageCursor) break;
    }
    const profile = await host.fetchBusinessProfile(info.jid);
    return { wuid: info.jid, numberExists: true, isBusiness: profile?.isBusiness === true,
      catalogLength: products.size, catalog: [...products.values()], nextPageCursor,
      hasMore: Boolean(nextPageCursor), pageSize: limit };
  } catch {
    throw new InternalServerErrorException('Não foi possível consultar o catálogo comercial no WhatsApp.');
  }
}
export async function readZapoCollections(host: Host, data: getCollectionsDto) {
  const info = await owner(host, data.number);
  const limit = pageLimit(data.limit ?? 20);
  try {
    const result = await host.client.connectCatalog!.getCollections(info.jid, limit);
    const profile = await host.fetchBusinessProfile(info.jid);
    return { wuid: info.jid, name: info.name, numberExists: true, isBusiness: profile?.isBusiness === true,
      collectionsLength: result.collections.length, collections: result.collections };
  } catch {
    throw new InternalServerErrorException('Não foi possível consultar as coleções comerciais no WhatsApp.');
  }
}
