import { Auth, configService } from '@config/env.config';
import { timingSafeEqual } from 'crypto';

import { invalidOAuthToken } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

type GlobalApiKeyResolver = () => string | null | undefined;

export class MetaCloudAuthService {
  constructor(
    private readonly resolveGlobalApiKey: GlobalApiKeyResolver = () =>
      configService.get<Auth>('AUTHENTICATION')?.API_KEY?.KEY,
  ) {}

  public extractBearer(authorization?: string | string[]): string | null {
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!value || !/^Bearer\s+/i.test(value)) return null;
    const token = value.replace(/^Bearer\s+/i, '').trim();
    return token || null;
  }

  public assertAuthorized(identity: MetaCloudIdentity, authorization?: string | string[]): void {
    const provided = this.extractBearer(authorization);
    if (!provided) throw invalidOAuthToken();

    const accepted = [identity.token, this.resolveGlobalApiKey()]
      .filter((token): token is string => typeof token === 'string' && token.length > 0)
      .some((token) => this.safeEqual(provided, token));

    if (!accepted) throw invalidOAuthToken();
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
