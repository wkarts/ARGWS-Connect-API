import { Agent, request as httpsRequest, RequestOptions } from 'node:https';
import { ConnectionOptions } from 'node:tls';

import { GOOGLE_ENDPOINTS } from '../findhub.constants';
import { FindHubAuthError } from './findhub-auth.error';

export type GoogleAuthResponse = { status: number; text: string };
export type GoogleAuthTransport = (body: string) => Promise<GoogleAuthResponse>;
const MAX_RESPONSE_BYTES = 65536;
const REQUEST_TIMEOUT_MS = 30000;
// Only this private Android authentication endpoint uses this agent. No global TLS/fetch overrides.
// Its legacy HTTP/1.1 handshake must not advertise ALPN; certificate and hostname checks stay enabled.
const authAgent = new Agent({
  keepAlive: true,
  maxSockets: 8,
  maxFreeSockets: 2,
  maxCachedSessions: 100,
  minVersion: 'TLSv1.2',
  rejectUnauthorized: true,
  ALPNProtocols: [],
});

function transportError(error: unknown): FindHubAuthError {
  if (error instanceof FindHubAuthError) return error;
  const code = String((error as { code?: unknown })?.code || '');
  if (['ETIMEDOUT', 'ECONNABORTED', 'ABORT_ERR'].includes(code)) return new FindHubAuthError(9107);
  if (/^(?:ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|UNABLE_TO_VERIFY_|UNABLE_TO_GET_)/.test(code)) {
    return new FindHubAuthError(9108);
  }
  return new FindHubAuthError(9109);
}

/** No redirects, no automatic retries of one-use credentials, no insecure TLS fallback. */
export const requestGoogleAuth: GoogleAuthTransport = (body) => {
  if (Buffer.byteLength(body) > 32768) return Promise.reject(new FindHubAuthError(9101));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, response?: GoogleAuthResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(transportError(error));
      else resolve(response);
    };
    const options: RequestOptions & ConnectionOptions = {
      method: 'POST',
      agent: authAgent,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      ALPNProtocols: [],
      headers: {
        'User-Agent': 'GoogleAuth/1.4',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept-Encoding': 'identity',
        Accept: '*/*',
      },
    };
    const req = httpsRequest(GOOGLE_ENDPOINTS.androidAuth, options, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          chunks.length = 0;
          finish(new FindHubAuthError(9106));
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.once('aborted', () => finish(new FindHubAuthError(9109)));
      res.once('error', (error) => finish(error));
      res.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        chunks.length = 0;
        finish(undefined, { status: res.statusCode || 0, text });
      });
    });
    req.once('error', (error) => finish(error));
    const timer = setTimeout(() => {
      finish(new FindHubAuthError(9107));
      req.destroy();
    }, REQUEST_TIMEOUT_MS);
    timer.unref?.();
    req.end(body);
  });
};
