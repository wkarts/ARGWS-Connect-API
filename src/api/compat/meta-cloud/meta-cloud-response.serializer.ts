import { MetaCloudGraphError } from './meta-cloud.error';

export class MetaCloudResponseSerializer {
  public messageResponse(to: string, providerResult: any) {
    const id = this.providerMessageId(providerResult);
    if (!id) throw new MetaCloudGraphError(500, 'Provider did not return a message identifier.');
    const normalized = String(to || '').replace(/\D/g, '');
    return {
      messaging_product: 'whatsapp',
      contacts: [{ input: normalized || to, wa_id: normalized || to }],
      messages: [{ id }],
    };
  }

  public providerMessageId(result: any): string | null {
    const id =
      result?.key?.id ??
      result?.id ??
      result?.message?.key?.id ??
      result?.data?.key?.id ??
      result?.messages?.[0]?.id ??
      result?.data?.messages?.[0]?.id;
    return id ? String(id) : null;
  }
}
