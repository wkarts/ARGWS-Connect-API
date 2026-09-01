import { timingSafeEqual } from 'crypto';

import { invalidOAuthToken } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudAuthService {
  public extractBearer(authorization?: string | string[]): string | null {
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!value || !/^Bearer\s+/i.test(value)) return null;
    const token = value.replace(/^Bearer\s+/i, '').trim();
    return token || null;
  }

  public assertAuthorized(identity: MetaCloudIdentity, authorization?: string | string[]): void {
    const provided = this.extractBearer(authorization);
    const expected = identity.token;
    if (!provided || !expected || !this.safeEqual(provided, expected)) throw invalidOAuthToken();
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
