import type { WaClientPluginContext, WaClientPluginDefinition } from '@innovatorssoft/zapo-js';

type CatalogNode = Parameters<WaClientPluginContext['queryWithContext']>[1];
type Query = WaClientPluginContext['queryWithContext'];

function children(node?: CatalogNode, tag?: string): CatalogNode[] {
  if (!node || !Array.isArray(node.content)) return [];
  return node.content.filter((child) => !tag || child.tag === tag);
}
function child(node: CatalogNode | undefined, tag: string): CatalogNode | undefined {
  return children(node, tag)[0];
}
function text(node: CatalogNode | undefined, tag: string): string | undefined {
  const value = child(node, tag)?.content;
  if (typeof value === 'string') return value;
  return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : undefined;
}
function valueNode(tag: string, value: string | number): CatalogNode {
  return { tag, attrs: {}, content: Buffer.from(String(value)) };
}
function positiveInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error('Invalid catalog page limit');
  return parsed;
}
function userJid(value: string): string {
  // Only typed user identities are accepted. A LID never becomes a telephone.
  if (!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(value)) throw new Error('Invalid catalog owner JID');
  return value.replace(/:\d+@/, '@');
}
function requiredResult(node: CatalogNode, tag: string): CatalogNode {
  const error = child(node, 'error');
  if (node.attrs?.type === 'error' || error) {
    const code = String(error?.attrs?.code || 'unknown');
    throw new Error(`WhatsApp catalog request rejected (${/^\d{3}$/.test(code) ? code : 'unknown'})`);
  }
  const result = child(node, tag);
  if (!result) throw new Error('Unexpected WhatsApp catalog response');
  return result;
}
function parseProduct(node: CatalogNode) {
  const id = text(node, 'id');
  const name = text(node, 'name');
  if (!id || !name) throw new Error('Invalid WhatsApp product response');
  const image = child(child(node, 'media'), 'image');
  const priceText = text(node, 'price');
  const price = priceText === undefined ? undefined : Number(priceText);
  if (price !== undefined && !Number.isFinite(price)) throw new Error('Invalid WhatsApp product price');
  return {
    id,
    name,
    description: text(node, 'description') || '',
    retailerId: text(node, 'retailer_id'),
    url: text(node, 'url'),
    price,
    currency: text(node, 'currency'),
    isHidden: node.attrs.is_hidden === 'true',
    // Preserve protocol price units, as the existing Baileys contract does.
    imageUrls: { requested: text(image, 'request_image_url'), original: text(image, 'original_image_url') },
    reviewStatus: { whatsapp: text(child(node, 'status_info'), 'status') },
    availability: text(node, 'availability'),
  };
}

/** Read-only WhatsApp commerce over ZAPO's public plugin query surface.
 * No Baileys socket, private coordinator import, auth export or extra session.
 */
export function createCatalogReader(query: Query) {
  const pending = new Map<string, Promise<any>>();
  const singleFlight = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    if (pending.has(key)) return pending.get(key)!;
    if (pending.size >= 4) return Promise.reject(new Error('Too many concurrent catalog requests'));
    const promise = task().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
  return {
    getCatalog({ jid, limit, cursor }: { jid: string; limit?: number; cursor?: string }) {
      jid = userJid(jid);
      const pageSize = positiveInteger(limit, 10, 100);
      if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096)) {
        throw new Error('Invalid catalog cursor');
      }
      return singleFlight(`catalog:${jid}:${pageSize}:${cursor || ''}`, async () => {
        const content = [valueNode('limit', pageSize), valueNode('width', 100), valueNode('height', 100)];
        if (cursor) content.push(valueNode('after', cursor));
        const response = await query(
          'connect.catalog.read',
          {
            tag: 'iq',
            attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:biz:catalog' },
            content: [{ tag: 'product_catalog', attrs: { jid, allow_shop_source: 'true' }, content }],
          },
          15_000,
        );
        const result = requiredResult(response, 'product_catalog');
        return {
          products: children(result, 'product').map(parseProduct),
          nextPageCursor: text(child(result, 'paging'), 'after'),
        };
      });
    },
    getCollections(jid: string, limit = 20) {
      jid = userJid(jid);
      const pageSize = positiveInteger(limit, 20, 100);
      return singleFlight(`collections:${jid}:${pageSize}`, async () => {
        const response = await query(
          'connect.collections.read',
          {
            tag: 'iq',
            attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:biz:catalog', smax_id: '35' },
            content: [
              {
                tag: 'collections',
                attrs: { biz_jid: jid },
                content: [
                  valueNode('collection_limit', pageSize),
                  valueNode('item_limit', pageSize),
                  valueNode('width', 100),
                  valueNode('height', 100),
                ],
              },
            ],
          },
          15_000,
        );
        const result = requiredResult(response, 'collections');
        return {
          collections: children(result, 'collection').map((collection) => {
            const id = text(collection, 'id'),
              name = text(collection, 'name');
            if (!id || !name) throw new Error('Invalid WhatsApp collection response');
            const status = child(collection, 'status_info');
            return {
              id,
              name,
              products: children(collection, 'product').map(parseProduct),
              status: { status: text(status, 'status'), canAppeal: text(status, 'can_appeal') === 'true' },
            };
          }),
        };
      });
    },
  };
}

export function connectCatalogPlugin(): WaClientPluginDefinition {
  return {
    id: 'connect-commerce',
    exposeAs: 'connectCatalog',
    setup: (ctx) => createCatalogReader((...args) => ctx.queryWithContext(...args)),
  };
}
