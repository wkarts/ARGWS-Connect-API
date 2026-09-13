import { RtpPacket } from '../media/rtp.js';
import { type SrtpKeyingMaterial } from '../types.js';
export declare class SrtpContext {
  private sessionKey;
  private sessionSalt;
  private authKey;
  private roc;
  private lastSeq;
  private initialized;
  private highestIndex;
  private replayMask;
  private authTagLen;
  private readonly ivBuffer;
  private readonly ssrcBuffer;
  private readonly indexBuffer;
  private readonly rocBuffer;
  constructor(keying: SrtpKeyingMaterial, authTagLen?: number);
  setAuthKeying(keying: SrtpKeyingMaterial): void;
  protect(packet: RtpPacket): Uint8Array;
  unprotect(data: Uint8Array): RtpPacket;
  private updateRoc;
  private estimateRoc;
  private isReplayed;
  private advanceReplay;
  private packetIndex;
  private generateIv;
  private computeAuthTag;
}
export declare class SrtpSession {
  private sendKey;
  private recvKey;
  private sendAuthLen;
  private recvAuthLen;
  private sendContexts;
  private recvContexts;
  private sendAuthKeying;
  constructor(sendKey: SrtpKeyingMaterial, recvKey: SrtpKeyingMaterial, sendAuthLen?: number, recvAuthLen?: number);
  protect(packet: RtpPacket): Uint8Array;
  unprotect(data: Uint8Array): RtpPacket;
  setSendAuthKeying(keying: SrtpKeyingMaterial): void;
}
export declare class SrtcpContext {
  private cipherKey;
  private authKey;
  private salt;
  private authTagLen;
  private index;
  private recvContexts;
  constructor(keying: SrtpKeyingMaterial, authTagLen?: number);
  protect(rtcp: Uint8Array, senderSsrc: number): Uint8Array;
  unprotect(data: Uint8Array): Uint8Array;
  private generateIv;
}
export declare class SrtpError extends Error {
  type:
    | 'packet_too_short'
    | 'auth_failed'
    | 'replay'
    | 'encryption'
    | 'decryption'
    | 'context_limit'
    | 'invalid_packet'
    | 'index_exhausted';
  constructor(type: SrtpError['type'], message: string);
}
