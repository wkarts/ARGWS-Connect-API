import { GOOGLE_ADM_CONFIG, GOOGLE_ENDPOINTS, GOOGLE_OAUTH_SCOPES } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';

function parseKeyValue(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split(/\r?\n/).filter(Boolean).map((line) => {
      const index = line.indexOf('=');
      return index < 0 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
    }),
  );
}

async function request(form: URLSearchParams): Promise<Record<string, string>> {
  const response = await fetch(GOOGLE_ENDPOINTS.androidAuth, {
    method: 'POST',
    headers: {
      'User-Agent': 'GoogleAuth/1.4 (gzip)',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Encoding': 'identity',
      Accept: '*/*',
      Connection: 'Keep-Alive',
    },
    body: form.toString(),
  });
  const text = await response.text();
  const data = parseKeyValue(text);
  if (!response.ok || data.Error || data.ErrorDetail || data.ErrorMsg) {
    throw new Error(`Google account authentication failed (${data.Error || response.status})`);
  }
  return data;
}

export class GooglePlayAuthClient {
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
    const result = await request(form);
    const token = result.Auth;
    if (!token) throw new Error(`Google ${scope} token was not returned`);
    return token;
  }
}
