import { uint8TimingSafeEqual } from 'zapo-js/util';

import { concatBytes, readUInt32BE, writeBigUInt64BE, writeUInt32BE } from '../bytes.js';
import { validateRtcpCompound } from '../media/rtcp.js';
import { RtpHeader, RtpPacket } from '../media/rtp.js';
import { SRTP_AUTH_TAG_LEN, SRTP_LABEL } from '../types.js';
import { aesCtr128, hmacSha1 } from './primitives.js';
const SRTP_REPLAY_WINDOW = 64n;
const SRTP_INDEX_MASK = (1n << 64n) - 1n;
export class SrtpContext {
  constructor(keying, authTagLen) {
    this.roc = 0;
    this.lastSeq = 0;
    this.initialized = false;
    this.highestIndex = 0n;
    this.replayMask = 0n;
    this.ivBuffer = new Uint8Array(16);
    this.ssrcBuffer = new Uint8Array(4);
    this.indexBuffer = new Uint8Array(8);
    this.rocBuffer = new Uint8Array(4);
    this.authTagLen = authTagLen ?? SRTP_AUTH_TAG_LEN;
    this.sessionKey = deriveKey(keying.masterKey, keying.masterSalt, SRTP_LABEL.ENCRYPTION, 16);
    this.authKey = deriveKey(keying.masterKey, keying.masterSalt, SRTP_LABEL.AUTH, 20);
    this.sessionSalt = deriveKey(keying.masterKey, keying.masterSalt, SRTP_LABEL.SALT, 14);
  }
  setAuthKeying(keying) {
    this.authKey = deriveKey(keying.masterKey, keying.masterSalt, SRTP_LABEL.AUTH, 20);
  }
  protect(packet) {
    this.updateRoc(packet.header.sequenceNumber);
    const index = this.packetIndex(packet.header.sequenceNumber);
    const headerSize = packet.header.size();
    const output = new Uint8Array(headerSize + packet.payload.length + this.authTagLen);
    packet.header.encode(output);
    const iv = this.generateIv(packet.header.ssrc, index);
    const encrypted = aesCtr128(this.sessionKey, iv, packet.payload);
    output.set(encrypted, headerSize);
    if (this.authTagLen > 0) {
      const authData = output.subarray(0, headerSize + packet.payload.length);
      const tag = this.computeAuthTag(authData, this.roc, this.authTagLen);
      output.set(tag, headerSize + packet.payload.length);
    }
    return output;
  }
  unprotect(data) {
    if (data.length < 12) {
      throw new SrtpError('packet_too_short', `Packet too short: ${data.length} bytes`);
    }
    const header = RtpHeader.decode(data);
    const headerSize = header.size();
    const payloadLen = data.length - headerSize - this.authTagLen;
    if (payloadLen <= 0) {
      throw new SrtpError(
        'packet_too_short',
        `No payload: ${data.length}B total, ${headerSize}B header, auth=${this.authTagLen}`,
      );
    }
    const seq = header.sequenceNumber;
    const estimatedRoc = this.estimateRoc(seq);
    const index = (BigInt(estimatedRoc) << 16n) | BigInt(seq);
    if (this.isReplayed(index)) {
      throw new SrtpError('replay', `SRTP replay detected: index ${index}`);
    }
    if (this.authTagLen > 0) {
      const authStart = headerSize + payloadLen;
      const authData = data.subarray(0, authStart);
      const expected = this.computeAuthTag(authData, estimatedRoc, this.authTagLen);
      const received = data.subarray(authStart, authStart + this.authTagLen);
      if (!uint8TimingSafeEqual(expected, received)) {
        throw new SrtpError('auth_failed', 'SRTP auth tag verification failed');
      }
    }
    const iv = this.generateIv(header.ssrc, index);
    const decrypted = aesCtr128(this.sessionKey, iv, data.subarray(headerSize, headerSize + payloadLen));
    this.advanceReplay(index, estimatedRoc, seq);
    return new RtpPacket(header, decrypted);
  }
  updateRoc(seq) {
    if (!this.initialized) {
      this.lastSeq = seq;
      this.initialized = true;
      return;
    }
    const diff = seq - this.lastSeq;
    if (diff < -32768) {
      this.roc = (this.roc + 1) >>> 0;
    }
    this.lastSeq = seq;
  }
  estimateRoc(seq) {
    if (!this.initialized) {
      return this.roc;
    }
    if (this.lastSeq < 32768) {
      return seq - this.lastSeq > 32768 ? (this.roc - 1) >>> 0 : this.roc;
    }
    return this.lastSeq - seq > 32768 ? (this.roc + 1) >>> 0 : this.roc;
  }
  isReplayed(index) {
    if (!this.initialized) {
      return false;
    }
    if (index > this.highestIndex) {
      return false;
    }
    const offset = this.highestIndex - index;
    if (offset >= SRTP_REPLAY_WINDOW) {
      return true;
    }
    return (this.replayMask & (1n << offset)) !== 0n;
  }
  advanceReplay(index, estimatedRoc, seq) {
    if (this.initialized && index <= this.highestIndex) {
      const offset = this.highestIndex - index;
      if (offset < SRTP_REPLAY_WINDOW) {
        this.replayMask |= 1n << offset;
      }
      return;
    }
    const shift = this.initialized ? index - this.highestIndex : SRTP_REPLAY_WINDOW;
    this.replayMask = shift >= SRTP_REPLAY_WINDOW ? 1n : ((this.replayMask << shift) | 1n) & SRTP_INDEX_MASK;
    this.highestIndex = index;
    this.roc = estimatedRoc;
    this.lastSeq = seq;
    this.initialized = true;
  }
  packetIndex(seq) {
    return (BigInt(this.roc) << 16n) | BigInt(seq);
  }
  generateIv(ssrc, index) {
    this.ivBuffer.fill(0);
    this.ivBuffer.set(this.sessionSalt.subarray(0, 14), 0);
    writeUInt32BE(this.ssrcBuffer, ssrc, 0);
    for (let i = 0; i < 4; i++) {
      this.ivBuffer[4 + i] ^= this.ssrcBuffer[i];
    }
    writeBigUInt64BE(this.indexBuffer, index, 0);
    for (let i = 0; i < 6; i++) {
      this.ivBuffer[8 + i] ^= this.indexBuffer[2 + i];
    }
    return this.ivBuffer;
  }
  computeAuthTag(data, roc, tagLen = SRTP_AUTH_TAG_LEN) {
    writeUInt32BE(this.rocBuffer, roc, 0);
    const result = hmacSha1(this.authKey, data, this.rocBuffer);
    return result.subarray(0, tagLen);
  }
}
// Keep rollover counters and replay windows isolated across audio and video SSRCs.
// Never evict a context: eviction would let an old authenticated packet be replayed.
const MAX_SSRC_CONTEXTS = 32;
export class SrtpSession {
  constructor(sendKey, recvKey, sendAuthLen, recvAuthLen) {
    this.sendKey = sendKey;
    this.recvKey = recvKey;
    this.sendAuthLen = sendAuthLen;
    this.recvAuthLen = recvAuthLen;
    this.sendContexts = new Map();
    this.recvContexts = new Map();
    this.sendAuthKeying = null;
  }
  protect(packet) {
    const ssrc = packet.header.ssrc;
    let ctx = this.sendContexts.get(ssrc);
    if (!ctx) {
      if (this.sendContexts.size >= MAX_SSRC_CONTEXTS) {
        throw new SrtpError('context_limit', 'SRTP sender SSRC limit reached');
      }
      ctx = new SrtpContext(this.sendKey, this.sendAuthLen);
      if (this.sendAuthKeying) ctx.setAuthKeying(this.sendAuthKeying);
      const encrypted = ctx.protect(packet);
      this.sendContexts.set(ssrc, ctx);
      return encrypted;
    }
    return ctx.protect(packet);
  }
  unprotect(data) {
    const header = RtpHeader.decode(data);
    let ctx = this.recvContexts.get(header.ssrc);
    if (!ctx) {
      if (this.recvContexts.size >= MAX_SSRC_CONTEXTS) {
        throw new SrtpError('context_limit', 'SRTP receiver SSRC limit reached');
      }
      ctx = new SrtpContext(this.recvKey, this.recvAuthLen);
      // Unauthenticated sources must not consume the bounded context table.
      const packet = ctx.unprotect(data);
      this.recvContexts.set(header.ssrc, ctx);
      return packet;
    }
    return ctx.unprotect(data);
  }
  setSendAuthKeying(keying) {
    this.sendAuthKeying = keying;
    for (const ctx of this.sendContexts.values()) ctx.setAuthKeying(keying);
  }
}

/** AES-CM/HMAC-SHA1 SRTCP. Use distinct instances for send and receive keying. */
export class SrtcpContext {
  constructor(keying, authTagLen = SRTP_AUTH_TAG_LEN) {
    if (!Number.isInteger(authTagLen) || authTagLen < 4 || authTagLen > 20) {
      throw new SrtpError('invalid_packet', 'SRTCP authentication length must be between 4 and 20 bytes');
    }
    this.cipherKey = deriveKey(keying.masterKey, keying.masterSalt, 0x03, 16);
    this.authKey = deriveKey(keying.masterKey, keying.masterSalt, 0x04, 20);
    this.salt = deriveKey(keying.masterKey, keying.masterSalt, 0x05, 14);
    this.authTagLen = authTagLen;
    this.index = 0;
    this.recvContexts = new Map();
  }
  protect(rtcp, senderSsrc) {
    validateRtcpCompound(rtcp);
    if (rtcp.length < 8 || readUInt32BE(rtcp, 4) !== senderSsrc) {
      throw new SrtpError('invalid_packet', 'SRTCP sender SSRC does not match the clear header');
    }
    // An index must never wrap with the same key and SSRC (AES-CTR IV reuse).
    if (this.index > 0x7fffffff) {
      throw new SrtpError('index_exhausted', 'SRTCP key lifetime exhausted');
    }
    const current = this.index;
    const encrypted = aesCtr128(this.cipherKey, this.generateIv(senderSsrc, current), rtcp.subarray(8));
    const indexWord = new Uint8Array(4);
    writeUInt32BE(indexWord, (0x80000000 | current) >>> 0, 0);
    const authenticated = concatBytes([rtcp.subarray(0, 8), encrypted, indexWord]);
    const result = concatBytes([authenticated, hmacSha1(this.authKey, authenticated).subarray(0, this.authTagLen)]);
    this.index += 1;
    return result;
  }
  unprotect(data) {
    if (data.length < 12 + this.authTagLen) {
      throw new SrtpError(
        'packet_too_short',
        'SRTCP packet has no complete clear header, index and authentication tag',
      );
    }
    const authStart = data.length - this.authTagLen;
    const indexOffset = authStart - 4;
    if (indexOffset % 4 !== 0 || indexOffset > 65536) {
      throw new SrtpError('invalid_packet', 'SRTCP payload is not aligned to a complete RTCP packet');
    }
    const authenticated = data.subarray(0, authStart);
    const expected = hmacSha1(this.authKey, authenticated).subarray(0, this.authTagLen);
    if (!uint8TimingSafeEqual(expected, data.subarray(authStart))) {
      throw new SrtpError('auth_failed', 'SRTCP auth tag verification failed');
    }
    const senderSsrc = readUInt32BE(data, 4);
    const indexWord = readUInt32BE(data, indexOffset);
    const index = BigInt(indexWord & 0x7fffffff);
    let replay = this.recvContexts.get(senderSsrc);
    if (replay) {
      const offset = replay.highestIndex - index;
      if (offset >= SRTP_REPLAY_WINDOW || (offset >= 0n && (replay.mask & (1n << offset)) !== 0n)) {
        throw new SrtpError('replay', 'SRTCP replay detected');
      }
    } else if (this.recvContexts.size >= MAX_SSRC_CONTEXTS) {
      throw new SrtpError('context_limit', 'SRTCP receiver SSRC limit reached');
    }
    const result = new Uint8Array(indexOffset);
    result.set(data.subarray(0, 8));
    // The E bit is authenticated too. RFC 3711 also permits authenticated clear RTCP.
    result.set(
      (indexWord & 0x80000000) !== 0
        ? aesCtr128(this.cipherKey, this.generateIv(senderSsrc, Number(index)), data.subarray(8, indexOffset))
        : data.subarray(8, indexOffset),
      8,
    );
    // Do not publish feedback or consume its index until all compound boundaries validate.
    validateRtcpCompound(result);
    if (!replay) {
      replay = { highestIndex: index, mask: 1n };
      this.recvContexts.set(senderSsrc, replay);
    } else if (index > replay.highestIndex) {
      const shift = index - replay.highestIndex;
      replay.mask = shift >= SRTP_REPLAY_WINDOW ? 1n : ((replay.mask << shift) | 1n) & SRTP_INDEX_MASK;
      replay.highestIndex = index;
    } else {
      replay.mask |= 1n << (replay.highestIndex - index);
    }
    return result;
  }
  generateIv(ssrc, index) {
    const iv = new Uint8Array(16);
    iv.set(this.salt, 0);
    const ssrcBytes = new Uint8Array(4);
    writeUInt32BE(ssrcBytes, ssrc, 0);
    for (let i = 0; i < 4; i++) iv[4 + i] ^= ssrcBytes[i];
    const indexBytes = new Uint8Array(8);
    writeBigUInt64BE(indexBytes, BigInt(index), 0);
    for (let i = 0; i < 6; i++) iv[8 + i] ^= indexBytes[2 + i];
    return iv;
  }
}

function deriveKey(masterKey, masterSalt, label, length) {
  const iv = new Uint8Array(16);
  iv.set(masterSalt.subarray(0, 14), 0);
  iv[7] ^= label;
  const zeros = new Uint8Array(length);
  return aesCtr128(masterKey, iv, zeros);
}
export class SrtpError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
    this.name = 'SrtpError';
  }
}
