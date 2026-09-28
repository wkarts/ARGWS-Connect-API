import { readUInt16BE, readUInt32BE, writeUInt16BE, writeUInt32BE } from '../bytes.js';
import { randomBytes } from '../crypto/primitives.js';
const NTP_UNIX_OFFSET = 2208988800;
export function buildSenderReportWithSdes(ssrc, packetCount, octetCount, rtpTimestamp, cname = randomBytes(18)) {
  // WhatsApp video uses the profile-specific bit on both compound packets and
  // a 32-byte SDES chunk (including END/padding), for 60 bytes in total.
  const report = new Uint8Array(60);
  const now = Date.now();
  const unixSeconds = Math.floor(now / 1000);
  const fraction = Math.floor(((now % 1000) / 1000) * 0x100000000) >>> 0;
  report[0] = 0x90;
  report[1] = 200;
  writeUInt16BE(report, 6, 2);
  writeUInt32BE(report, ssrc, 4);
  writeUInt32BE(report, (unixSeconds + NTP_UNIX_OFFSET) >>> 0, 8);
  writeUInt32BE(report, fraction, 12);
  writeUInt32BE(report, rtpTimestamp >>> 0, 16);
  writeUInt32BE(report, packetCount >>> 0, 20);
  writeUInt32BE(report, octetCount >>> 0, 24);
  report[28] = 0x91;
  report[29] = 202;
  writeUInt16BE(report, 7, 30);
  writeUInt32BE(report, ssrc, 32);
  report[36] = 1;
  report[37] = 18;
  const hex = '0123456789abcdef';
  const nativeCname = new Uint8Array(18);
  for (let i = 0; i < 11; i++) {
    const value = cname[6 + Math.floor(i / 2)] || 0;
    nativeCname[i < 5 ? i : i + 3] = hex.charCodeAt(i % 2 === 0 ? value >>> 4 : value & 0x0f);
  }
  nativeCname.set(new TextEncoder().encode('@pj'), 5);
  nativeCname.set(new TextEncoder().encode('.org'), 14);
  report.set(nativeCname, 38);
  return report;
}
/** RFC 4585 Picture Loss Indication. Requests an immediate H.264 key frame. */
export function buildPictureLossIndication(senderSsrc, mediaSsrc, whatsappVideoProfile = true) {
  const packet = new Uint8Array(12);
  // WhatsApp sets the profile-specific bit on video feedback. Without it,
  // mobile clients accept the SRTCP packet but ignore the key-frame request.
  packet[0] = whatsappVideoProfile ? 0x91 : 0x81; // V=2, profile, FMT=1 (PLI)
  packet[1] = 206; // Payload-specific feedback
  writeUInt16BE(packet, 2, 2);
  writeUInt32BE(packet, senderSsrc, 4);
  writeUInt32BE(packet, mediaSsrc, 8);
  return packet;
}
/** RFC 5104 Full Intra Request. Some WhatsApp devices react to FIR but not PLI. */
export function buildFullIntraRequest(senderSsrc, mediaSsrc, sequenceNumber) {
  const packet = new Uint8Array(20);
  packet[0] = 0x84; // V=2, FMT=4 (FIR)
  packet[1] = 206;
  writeUInt16BE(packet, 4, 2);
  writeUInt32BE(packet, senderSsrc, 4);
  writeUInt32BE(packet, 0, 8);
  writeUInt32BE(packet, mediaSsrc, 12);
  packet[16] = sequenceNumber & 0xff;
  return packet;
}

// Validate the complete compound packet before returning any feedback. A valid
// leading PLI followed by a malformed/truncated packet must not request a frame.
function parseCompoundPackets(data) {
  if (!(data instanceof Uint8Array) || data.length < 4 || data.length % 4 !== 0 || data.length > 65536) {
    throw new Error('Invalid RTCP compound length');
  }
  const packets = [];
  let offset = 0;
  while (offset < data.length) {
    if (data.length - offset < 4 || data[offset] >>> 6 !== 2) {
      throw new Error('Invalid RTCP packet header');
    }
    const packetType = data[offset + 1];
    if (packetType < 192 || packetType > 223) {
      throw new Error('Invalid RTCP packet type');
    }
    const packetLength = (readUInt16BE(data, offset + 2) + 1) * 4;
    const end = offset + packetLength;
    if (end > data.length) {
      throw new Error('Truncated RTCP compound packet');
    }
    let contentEnd = end;
    if ((data[offset] & 0x20) !== 0) {
      const padding = data[end - 1];
      if (end !== data.length || padding === 0 || padding > packetLength - 4) {
        throw new Error('Invalid RTCP padding');
      }
      contentEnd -= padding;
    }
    // WhatsApp uses bit 0x10 as a video profile flag (0x91 for PLI).
    // It is distinct from the standard RTCP padding bit, which is 0x20.
    const rawFormat = data[offset] & 0x1f;
    const format = rawFormat === 17 ? 1 : rawFormat === 20 ? 4 : rawFormat;
    const contentLength = contentEnd - offset;
    if (packetType === 206 && format === 1 && contentLength !== 12) {
      throw new Error('Invalid RTCP PLI length');
    }
    if (packetType === 206 && format === 4 && (contentLength < 20 || (contentLength - 12) % 8 !== 0)) {
      throw new Error('Invalid RTCP FIR length');
    }
    if ((packetType === 205 || packetType === 206) && contentLength < 12) {
      throw new Error('Truncated RTCP feedback header');
    }
    packets.push({ offset, contentEnd, packetType, format });
    offset = end;
  }
  return packets;
}

export function validateRtcpCompound(data) {
  parseCompoundPackets(data);
}

/** Parse only authenticated/decrypted SRTCP output; never raw network bytes. */
export function parseVideoKeyFrameFeedback(data) {
  const packets = parseCompoundPackets(data);
  const result = [];
  for (const { offset, contentEnd, packetType, format } of packets) {
    if (packetType !== 206) continue;
    if (format === 1) {
      result.push({
        type: 'pli',
        senderSsrc: readUInt32BE(data, offset + 4),
        mediaSsrc: readUInt32BE(data, offset + 8),
      });
    } else if (format === 4) {
      for (let fci = offset + 12; fci < contentEnd; fci += 8) {
        result.push({
          type: 'fir',
          senderSsrc: readUInt32BE(data, offset + 4),
          mediaSsrc: readUInt32BE(data, fci),
          sequenceNumber: data[fci + 4],
        });
      }
    }
  }
  return result;
}
