export type MetaCloudStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';

export class MetaCloudStatusMapper {
  public map(status?: string | number | null): MetaCloudStatus | null {
    const value = String(status ?? '').toUpperCase();
    switch (value) {
      case '2':
      case 'SERVER_ACK':
        return 'sent';
      case '3':
      case 'DELIVERY_ACK':
        return 'delivered';
      case '4':
      case 'READ':
      case '5':
      case 'PLAYED':
        return 'read';
      case '0':
      case 'ERROR':
        return 'failed';
      case 'DELETED':
        return 'deleted';
      case '1':
      case 'PENDING':
      case '':
        return null;
      default:
        return null;
    }
  }
}
