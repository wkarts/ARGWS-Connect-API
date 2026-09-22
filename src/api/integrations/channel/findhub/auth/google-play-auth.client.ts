import { GOOGLE_ADM_CONFIG, GOOGLE_OAUTH_SCOPES } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import {
  FindHubAuthError,
  FindHubAuthErrorCode,
  FindHubAuthPhase,
  normalizeFindHubAuthReason,
  safeFindHubAuthError,
} from './findhub-auth.error';
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
  // chrome.cookies.get returns the cookie value, not a URL query parameter. Preserve all opaque bytes.
  // URLSearchParams below performs the single required form encoding. Never decode or retry a login token.
  const token = value;
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

  private async request(form: URLSearchParams, phase: FindHubAuthPhase): Promise<Record<string, string>> {
    let response: Awaited<ReturnType<GoogleAuthTransport>>;
    try {
      response = await this.transport(form.toString());
    } catch (error) {
      throw safeFindHubAuthError(error, 9109);
    }
    const fail = (code: FindHubAuthErrorCode, reason: string, data: Record<string, string> = {}) =>
      new FindHubAuthError(code, {
        phase,
        http: response.status,
        reason,
        token: Boolean(data.Token),
        auth: Boolean(data.Auth),
        error: Boolean(data.Error),
        detail: Boolean(data.ErrorDetail || data.ErrorMsg),
      });
    if (response.status === 429 || response.status >= 500) throw fail(9109, 'ServiceUnavailable');
    if (response.status >= 300 && response.status < 400) throw fail(9103, 'NeedsBrowser');
    let data: Record<string, string>;
    try {
      data = parseKeyValue(response.text);
    } catch {
      throw fail(9106, 'MALFORMED_RESPONSE');
    }
    // ErrorDetail/ErrorMsg are never returned or logged: they may contain login URLs and account data.
    const reason = normalizeFindHubAuthReason(
      data.Error?.trim() || (response.status < 200 || response.status >= 300 ? 'HTTP_ERROR' : 'ERROR_FIELDS'),
    );
    if (['BadAuthentication', 'InvalidToken', 'ExpiredToken'].includes(reason)) throw fail(9102, reason, data);
    if (['NeedsBrowser', 'CaptchaRequired', 'InvalidSecondFactor', 'WebLoginRequired'].includes(reason)) {
      throw fail(9103, reason, data);
    }
    if (
      [
        'InvalidRequest',
        'BadRequest',
        'InvalidArgument',
        'InvalidClient',
        'InvalidScope',
        'InvalidService',
        'UnsupportedService',
      ].includes(reason)
    )
      throw fail(9115, reason, data);
    if (['DroidGuardRequired', 'InvalidDroidGuard', 'DeviceIntegrityRequired', 'AttestationRequired'].includes(reason))
      throw fail(9116, reason, data);
    if (response.status < 200 || response.status >= 300 || data.Error || data.ErrorDetail || data.ErrorMsg) {
      throw fail(9106, reason, data);
    }
    return data;
  }

  /** Redeem once; an absent optional Email field is not a failed login. */
  public async exchange(email: string, oauthToken: string, androidId: string): Promise<FindHubAasCredentials> {
    const requestedEmail = accountEmail(email);
    // The protocol takes the unsigned decimal identifier issued by Google check-in, not a fabricated hex UUID.
    if (!/^[1-9][0-9]{0,19}$/.test(androidId) || BigInt(androidId) > 18446744073709551615n)
      throw new FindHubAuthError(9101);
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
    const result = await this.request(form, 'exchange');
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
    const result = await this.request(form, scope);
    if (result.Email && accountEmail(result.Email) !== accountEmail(credentials.email))
      throw new FindHubAuthError(9104);
    if (!result.Auth) throw new FindHubAuthError(9105);
    return result.Auth;
  }
}
