import http2 from 'http2';

import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { GOOGLE_ADM_CONFIG, GOOGLE_ENDPOINTS } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import { decodeEncryptedOwnerKey, encodeGetEidInfoRequest } from './findhub-proto';

function grpcFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = 0;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function grpcPayload(payload: Buffer): Buffer {
  if (payload.length < 5) throw new Error('Invalid Spot gRPC response');
  let offset = 0;
  const chunks: Buffer[] = [];
  while (offset + 5 <= payload.length) {
    const compressed = payload[offset];
    const size = payload.readUInt32BE(offset + 1);
    offset += 5;
    if (offset + size > payload.length) break;
    if (compressed !== 0) throw new Error('Compressed Spot gRPC frames are not supported');
    chunks.push(payload.subarray(offset, offset + size));
    offset += size;
  }
  if (!chunks.length) throw new Error('Spot gRPC response did not contain a protobuf frame');
  return chunks[0];
}

export class FindHubSpotClient {
  constructor(
    private readonly auth: GooglePlayAuthClient,
    private readonly credentials: FindHubAasCredentials,
  ) {}

  private async request(method: string, payload: Buffer): Promise<Buffer> {
    const token = await this.auth.serviceToken(this.credentials, 'spot');
    return await new Promise<Buffer>((resolve, reject) => {
      const client = http2.connect(GOOGLE_ENDPOINTS.spotAuthority);
      client.once('error', (error) => {
        client.destroy();
        reject(error);
      });
      client.setTimeout(30_000, () => {
        client.destroy();
        reject(new Error('Google Spot request timed out'));
      });
      const request = client.request({
        ':method': 'POST',
        ':path': `${GOOGLE_ENDPOINTS.spotPath}/${method}`,
        'user-agent': GOOGLE_ADM_CONFIG.spotUserAgent,
        'content-type': 'application/grpc',
        te: 'trailers',
        authorization: `Bearer ${token}`,
        'grpc-accept-encoding': 'identity',
      });
      const chunks: Buffer[] = [];
      request.on('response', (headers) => {
        const status = Number(headers[':status'] || 0);
        if (status !== 200) reject(new Error(`Google Spot request failed (${status})`));
      });
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1048576) {
          request.close();
          client.destroy();
          reject(new Error('Google Spot response too large'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      request.on('trailers', (headers) => {
        if (headers['grpc-status'] && String(headers['grpc-status']) !== '0') {
          client.close();
          reject(new Error('Google Spot rejected the request'));
        }
      });
      request.on('end', () => {
        client.close();
        try {
          resolve(grpcPayload(Buffer.concat(chunks)));
        } catch (error) {
          reject(error);
        }
      });
      request.on('error', (error) => {
        client.close();
        reject(error);
      });
      request.end(grpcFrame(payload));
    });
  }

  public async ownerKeyEnvelope() {
    return decodeEncryptedOwnerKey(await this.request('GetEidInfoForE2eeDevices', encodeGetEidInfoRequest()));
  }
}
