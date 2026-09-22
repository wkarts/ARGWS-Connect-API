import { GOOGLE_ADM_CONFIG, GOOGLE_OAUTH_SCOPES } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import { FindHubAuthError, safeFindHubAuthError } from './findhub-auth.error';
import { GoogleAuthTransport, requestGoogleAuth } from './google-auth.transport';

function parseKeyValue(text: string): Record<string, string> {
  if (Buffer.byteLength(text) > 65536 || /^\s*</.test(text)) throw new FindHubAuthError(9106);
  const data: Record<string, string> = Object.create(null);
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line) continue;
    const index = line.indexOf('=');
    if (index < 1) throw new FindHubAuthError(9106);
    const key = line.slice(0, index);
    if (Object.prototype.hasOwnProperty.call(data, key)) throw new FindHubAuthError(9106);
    data[key] = line.slice(index + 1);
  }
  return data;
}

function loginToken(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 16384) throw new FindHubAuthError(9101);
  let token = value;
  // Decode URI-escaped cookie bytes once only. '+' is a literal token byte, never a form-space.
  if (/%[0-9a-f]{2}/i.test(token)) {
    try {
      token = decodeURIComponent(token);
    } catch {
      throw new FindHubAuthError(9101);
    }
  }
  if (
    !token ||
    /\s/.test(token) ||
    Array.from(token).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new FindHubAuthError(9101);
  return token;
}

function accountEmail(value: string): string {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FindHubAuthError(9101);
  return email;
}

export class GooglePlayAuthClient {
  constructor(private readonly transport: GoogleAuthTransport = requestGoogleAuth) {}

  private async request(form: URLSearchParams): Promise<Record<string, string>> {
    let response: Awaited<ReturnType<GoogleAuthTransport>>;
    try {
      response = await this.transport(form.toString());
    } catch (error) {
      throw safeFindHubAuthError(error, 9109);
    }
    if (response.status === 429 || response.status >= 500) throw new FindHubAuthError(9109);
    if (response.status >= 300 && response.status < 400) throw new FindHubAuthError(9103);
    const data = parseKeyValue(response.text);
    if (data.Error === 'BadAuthentication') throw new FindHubAuthError(9102);
    if (['NeedsBrowser', 'CaptchaRequired', 'InvalidSecondFactor', 'WebLoginRequired'].includes(data.Error)) {
      throw new FindHubAuthError(9103);
    }
    if (response.status < 200 || response.status >= 300 || data.Error || data.ErrorDetail || data.ErrorMsg) {
      throw new FindHubAuthError(9106);
    }
    return data;
  }

  /** Redeem once; an absent optional Email field is not a failed login. */
  public async exchange(email: string, oauthToken: string, androidId: string): Promise<FindHubAasCredentials> {
    const requestedEmail = accountEmail(email);
    const form = new URLSearchParams({
      accountType: 'HOSTED_OR_GOOGLE',
      Email: requestedEmail,
      has_permission: '1',
      add_account: '1',
      ACCESS_TOKEN: '1',
      Token: loginToken(oauthToken),
      service: 'ac2dm',
      source: 'android',
      androidId,
      device_country: 'us',
      operatorCountry: 'us',
      lang: 'en',
      sdk_version: '17',
      google_play_services_version: GOOGLE_ADM_CONFIG.googlePlayServicesVersion,
      client_sig: GOOGLE_ADM_CONFIG.clientSig,
      callerSig: GOOGLE_ADM_CONFIG.clientSig,
    });
    const result = await this.request(form);
    if (!result.Token) throw new FindHubAuthError(9105);
    if (result.Email && accountEmail(result.Email) !== requestedEmail) throw new FindHubAuthError(9104);
    const credentials = {
      email: result.Email ? accountEmail(result.Email) : requestedEmail,
      androidId,
      aasToken: result.Token,
    };
    // Prove that Google accepts the selected account + master token for Find Hub before proceeding.
    // This is a second service request, not a retry/redemption of the one-use browser artifact.
    await this.serviceToken(credentials, 'adm');
    return credentials;
  }

  public async serviceToken(credentials: FindHubAasCredentials, scope: 'adm' | 'spot'): Promise<string> {
    const serviceScope = scope === 'spot' ? GOOGLE_OAUTH_SCOPES.spot : GOOGLE_OAUTH_SCOPES.adm;
    const app = scope === 'spot' ? 'com.google.android.gms' : GOOGLE_ADM_CONFIG.androidPackage;
    const form = new URLSearchParams({
      accountType: 'HOSTED_OR_GOOGLE',
      Email: credentials.email,
      has_permission: '1',
      EncryptedPasswd: credentials.aasToken,
      service: `oauth2:https://www.googleapis.com/auth/${serviceScope}`,
      source: 'android',
      androidId: credentials.androidId,
      app,
      client_sig: GOOGLE_ADM_CONFIG.clientSig,
      device_country: 'us',
      operatorCountry: 'us',
      lang: 'en',
      sdk_version: '17',
      google_play_services_version: GOOGLE_ADM_CONFIG.googlePlayServicesVersion,
    });
    const result = await this.request(form);
    if (result.Email && accountEmail(result.Email) !== accountEmail(credentials.email))
      throw new FindHubAuthError(9104);
    if (!result.Auth) throw new FindHubAuthError(9105);
    return result.Auth;
  }
}
