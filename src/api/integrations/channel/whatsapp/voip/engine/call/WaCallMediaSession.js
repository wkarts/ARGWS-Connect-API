import { createHash } from 'node:crypto';

import { applyDeviceToJid, canonicalizeSignalJid, parseJidFull, toUserJid } from 'zapo-js/protocol';
import { getFirstNodeChild, getNodeChildrenByTag } from 'zapo-js/transport';
import { toError, uint8TimingSafeEqual } from 'zapo-js/util';

import { concatBytes, EMPTY_BYTES, readUInt32BE, toArrayBuffer } from '../bytes.js';
import { derivePerJidSrtpKey } from '../crypto/encryption.js';
import { randomBytes } from '../crypto/primitives.js';
import { SrtcpContext, SrtpSession } from '../crypto/srtp.js';
import { generateSecureSsrc } from '../crypto/ssrc.js';
import { H264Depacketizer, packetizeWhatsAppH264AccessUnit } from '../media/h264.js';
import { MLowCodec } from '../media/mlow-codec.js';
import {
  buildFullIntraRequest,
  buildPictureLossIndication,
  buildSenderReportWithSdes,
  parseVideoKeyFrameFeedback,
} from '../media/rtcp.js';
import { RtpSession } from '../media/rtp.js';
import { WaAudioEngine } from '../media/WaAudioEngine.js';
import { parseRelayFromAck } from '../relay/relay-ack.js';
import { isRtpPacket, isStunPacket } from '../relay/stun.js';
import { WaSctpRelay } from '../relay/WaSctpRelay.js';
import {
  buildAcceptReceiptStanza,
  buildAcceptStanza,
  buildMuteV2Stanza,
  buildPreacceptStanza,
  buildRejectStanza,
  buildRelaylatencyForwardStanza,
  buildRelayLatencyStanza,
  buildTerminateStanza,
  buildTransportStanza,
  decryptCallKey,
  extractNodeInfo,
  extractRelayEndpoints,
  needsDecryption,
} from '../signaling/signaling.js';
import {
  CallDirection,
  CallMediaType,
  CallState,
  EndCallReason,
  SRTP_AUTH_TAG_LEN,
  SRTP_RECV_AUTH_TAG_LEN,
  SRTP_SEND_AUTH_TAG_LEN,
} from '../types.js';
export class WaCallMediaSession {
  constructor(options) {
    this.rtpSession = null;
    this.srtpSession = null;
    this.opusCodec = null;
    this.initialTransportSent = false;
    this.outgoingPreacceptSent = false;
    this.selfSsrc = 0;
    this.peerSsrcs = [];
    this.firstPacketSent = false;
    this.acceptedByJid = null;
    this.debeEnabled = true;
    this.audioSendCount = 0;
    this.audioDropCount = 0;
    this.realAudioSendCount = 0;
    this.encodeBufferA = null;
    this.encodeBufferB = null;
    this.encodeBuffer = null;
    this.encodeBufferPos = 0;
    this.authPaddingBuffer = null;
    this.audioRecvCount = 0;
    this.recvRealCount = 0;
    this.recvDtxCount = 0;
    this.srtpErrorCount = 0;
    this.relayPacketCount = 0;
    this.stunResponseCount = 0;
    this.selfEchoCount = 0;
    this.lastRecvSeq = -1;
    this.recvSeqGaps = 0;
    this.actualPeerSsrc = null;
    this.ssrcResubscribed = false;
    this.videoRtpSession = null;
    this.sendSrtcp = null;
    this.recvSrtcp = null;
    this.selfStreamSsrcs = [];
    this.peerStreamSsrcs = [];
    this.videoDepacketizers = new Map();
    this.videoTimestampOwners = new Map();
    this.videoFrameNumber = 0;
    this.videoTransportSequence = 0;
    this.videoPacketCount = 0;
    this.videoOctetCount = 0;
    this.videoFirSequence = 0;
    this.lastVideoSentAt = 0;
    this.lastVideoCaptureUs = null;
    this.lastVideoRtpTimestamp = null;
    this.lastVideoPliAt = -Infinity;
    this.videoPliAttempts = 0;
    this.lastVideoFeedbackAt = -Infinity;
    this.videoClock = null;
    this.videoRtcpTimer = null;
    this.videoSubscriptionTimer = null;
    this.maxVideoFps = Math.min(30, Math.max(1, Number.isFinite(options.maxVideoFps) ? options.maxVideoFps : 30));
    this.deps = options.deps;
    this.logger = options.logger;
    this.info = options.info;
    this.delegate = options.delegate;
    this.sctpRelay = new WaSctpRelay({
      logger: this.logger.child({ component: 'sctp' }),
    });
    this.audioEngine = new WaAudioEngine({
      logger: this.logger.child({ component: 'audio-engine' }),
    });
    this.audioEngine.setAudioSender(this);
    this.audioEngine.setOnAudioFinished(() => {
      this.delegate.emitOutboundAudioFinished(this.info);
    });
    this.sctpRelay.on('relay_connected', () => {
      this.onRelayConnected();
    });
    this.sctpRelay.on('relay_receive', (relayInfo) => {
      this.onRelayData(relayInfo.data);
    });
  }
  get callId() {
    return this.info.callId;
  }
  async initMedia(selfLid, peerJid) {
    const ssrc = generateSecureSsrc(this.info.callId, this.ensureDeviceJid(selfLid));
    this.rtpSession = RtpSession.whatsappOpus(ssrc);
    this.selfSsrc = ssrc;
    const peerSsrc = generateSecureSsrc(this.info.callId, this.ensureDeviceJid(peerJid));
    this.peerSsrcs = [peerSsrc];
    this.initVideoStreams(this.ensureDeviceJid(selfLid), this.ensureDeviceJid(peerJid));
    this.logger.debug('call media initialized', {
      callId: this.info.callId,
      selfSsrc: `0x${ssrc.toString(16).toUpperCase()}`,
      peerSsrc: `0x${peerSsrc.toString(16).toUpperCase()}`,
    });
    this.opusCodec = await MLowCodec.create();
  }
  resetOutgoingFlags() {
    this.initialTransportSent = false;
    this.outgoingPreacceptSent = false;
  }
  // ARGWS: resolve account aliases without ever equating device ids across accounts.
  async argwsResolveDevice(jid) {
    const parsed = parseJidFull(canonicalizeSignalJid(jid));
    const creds = this.deps.authClient.getCurrentCredentials();
    const ownBases = [creds?.meJid, creds?.meLid]
      .filter(Boolean)
      .map((value) => toUserJid(canonicalizeSignalJid(value)));
    this.argwsIdentityCache ??= new Map();
    if (!this.argwsIdentityCache.has(parsed.userJid)) {
      const lookup = (async () => {
        const bases = new Set([parsed.userJid]);
        if (ownBases.includes(parsed.userJid)) {
          for (const base of ownBases) bases.add(base);
        } else {
          try {
            const pair = await this.deps.signalDeviceSync.resolveUserJidPair(parsed.userJid, 5000);
            for (const value of [pair?.pnJid, pair?.lidJid]) {
              if (value) bases.add(toUserJid(canonicalizeSignalJid(value)));
            }
          } catch {
            this.logger.warn('call identity lookup failed; uncertain devices will not be terminated', {
              callId: this.info.callId,
            });
          }
        }
        return bases;
      })();
      this.argwsIdentityCache.set(parsed.userJid, lookup);
    }
    const bases = await this.argwsIdentityCache.get(parsed.userJid);
    const canonicalBase = [...bases].find((base) => base.endsWith('@lid')) || parsed.userJid;
    const canonicalJid = applyDeviceToJid(canonicalBase, parsed.address.device);
    return { jid: parsed.normalizedJid, device: parsed.address.device, bases, canonicalJid };
  }
  async argwsIsOwnDevice(jid) {
    const identity = await this.argwsResolveDevice(jid);
    const creds = this.deps.authClient.getCurrentCredentials();
    return [creds?.meJid, creds?.meLid]
      .filter(Boolean)
      .some((value) => identity.bases.has(toUserJid(canonicalizeSignalJid(value))));
  }
  async argwsSameDevice(left, right) {
    const [a, b] = await Promise.all([this.argwsResolveDevice(left), this.argwsResolveDevice(right)]);
    return a.device === b.device && [...a.bases].some((base) => b.bases.has(base));
  }
  async argwsOtherDevices(winnerJid) {
    const winner = await this.argwsResolveDevice(winnerJid);
    const targets = new Set();
    for (const jid of [...(this.offeredDeviceJids || []), ...(this.info.relayData?.participantJids || [])]) {
      try {
        const candidate = await this.argwsResolveDevice(jid);
        if (await this.argwsIsOwnDevice(jid)) continue;
        // Unknown PN/LID relations are not evidence that this is a losing device.
        if (![...candidate.bases].some((base) => winner.bases.has(base))) continue;
        if (candidate.device !== winner.device) targets.add(candidate.jid);
      } catch {
        this.logger.warn('invalid call participant skipped', { callId: this.info.callId });
      }
    }
    return [...targets];
  }
  async acceptCall() {
    if (this.argwsLocalAcceptPromise) return this.argwsLocalAcceptPromise;
    if (!this.info.canAccept) {
      throw new Error(`Call ${this.info.callId} cannot be accepted in state ${this.info.stateData.state}`);
    }
    if (!this.info.encryptionKey || this.info.encryptionKey.length !== 32) {
      throw new Error(`Call ${this.info.callId} cannot be accepted without a valid decrypted call key`);
    }
    this.argwsLocalAcceptPromise = this.argwsSendAccept();
    try {
      await this.argwsLocalAcceptPromise;
    } finally {
      this.argwsLocalAcceptPromise = null;
    }
  }
  async argwsSendAccept() {
    const meId = this.deps.authClient.getCurrentCredentials()?.meJid ?? '';
    const callId = this.info.callId;
    const callCreator = this.info.callCreator;
    const peerJid = this.info.peerJid;
    const isVideo = this.info.mediaType === CallMediaType.Video;
    const assertStillAvailable = () => {
      if (!this.info.canAccept || this.argwsEndPromise) {
        throw new Error(`Call ${callId} is no longer available for local acceptance`);
      }
    };
    assertStillAvailable();
    // Prepare encryption before publishing state or sending any acceptance signaling.
    const acceptStanza = await buildAcceptStanza(
      this.deps,
      callId,
      this.info.encryptionKey,
      peerJid,
      callCreator,
      isVideo,
    );
    assertStillAvailable();
    try {
      const muteNode = buildMuteV2Stanza(peerJid, callId, callCreator, 0, meId);
      await this.deps.lowLevelCoordinator.sendNode(muteNode);
    } catch (err) {
      this.logger.error('error sending mute_v2', { message: toError(err).message });
    }
    assertStillAvailable();
    try {
      const transportNode = buildTransportStanza(peerJid, callId, callCreator, meId, '1', '1');
      await this.deps.lowLevelCoordinator.sendNode(transportNode);
    } catch (err) {
      this.logger.error('error sending transport', { message: toError(err).message });
    }
    assertStillAvailable();
    // An exception must reach the API; a local state change is not a sent accept.
    await this.deps.lowLevelCoordinator.sendNode(acceptStanza);
    assertStillAvailable();
    this.acceptedByJid = peerJid;
    this.updateVideoPeer(peerJid);
    this.info.applyTransition({ type: 'local_accepted' });
    this.initSrtpKeys();
    this.delegate.emitState(this.info);
    // A relay may have connected while the accept was being sent, before Connecting.
    if (this.sctpRelay.hasConnection()) {
      this.onRelayConnected();
    } else if (this.info.relayData) {
      await this.connectRelays(this.info.relayData.endpoints);
    }
    this.logger.debug('call acceptance sent', { callId });
  }
  async rejectCall(reason = EndCallReason.Declined) {
    this.info.applyTransition({ type: 'local_rejected', reason });
    this.delegate.emitState(this.info);
    const node = buildRejectStanza(this.info.peerJid, this.info.callId, this.info.callCreator);
    try {
      await this.deps.lowLevelCoordinator.sendNode(node);
    } catch (err) {
      this.logger.warn('reject send failed', { message: toError(err).message });
    }
    this.cleanup();
  }
  async endCall(reason = EndCallReason.UserEnded) {
    if (this.info.isEnded) return;
    if (this.argwsEndPromise) return this.argwsEndPromise;
    this.argwsEndPromise = this.argwsSendEnd(reason);
    try {
      await this.argwsEndPromise;
    } finally {
      this.argwsEndPromise = null;
    }
  }
  async argwsSendEnd(reason) {
    const connectedAt = this.info.stateData.connectedAt;
    const audioDurationMs = connectedAt ? Date.now() - connectedAt.getTime() : undefined;
    const targets = new Set([this.acceptedByJid || this.info.peerJid]);
    if (this.info.isInitiator && !this.acceptedByJid) {
      for (const jid of [...(this.offeredDeviceJids || []), ...(this.info.relayData?.participantJids || [])]) {
        try {
          if (!(await this.argwsIsOwnDevice(jid))) targets.add(jid);
        } catch {
          this.logger.warn('invalid call participant skipped', { callId: this.info.callId });
        }
      }
    }
    if (this.info.isEnded) return;
    const errors = [];
    for (const target of targets) {
      try {
        const node = buildTerminateStanza(target, this.info.callId, this.info.callCreator, audioDurationMs);
        await this.deps.lowLevelCoordinator.sendNode(node);
      } catch (error) {
        errors.push(error);
      }
    }
    // Keep the call retryable when signaling was not sent; never report local-only success.
    if (errors.length) {
      this.logger.warn('call termination signaling incomplete', {
        callId: this.info.callId,
        failedTargets: errors.length,
        targetCount: targets.size,
      });
      throw new globalThis.AggregateError(errors, 'Failed to send call termination signaling');
    }
    if (this.info.isEnded) return;
    this.info.applyTransition({ type: 'terminated', reason });
    this.delegate.emitEnded(this.info);
    this.delegate.emitState(this.info);
    this.cleanup();
  }
  setMute(muted) {
    if (!this.info.isActive) return;
    this.info.applyTransition({ type: 'audio_mute_changed', muted });
    this.delegate.emitState(this.info);
    if (muted) {
      this.audioEngine.stopCapture();
    } else {
      this.audioEngine.startCapture();
    }
  }
  async loadAudio(audioPath) {
    await this.audioEngine.loadAudioFile(audioPath);
    this.resetEncodeState();
    this.logger.debug('audio loaded for call', { callId: this.info.callId });
  }
  setExternalAudioMode(enabled) {
    this.audioEngine.setExternalMode(enabled);
    if (enabled) {
      this.resetEncodeState();
      this.logger.debug('external audio mode enabled', { callId: this.info.callId });
    }
  }
  feedLiveAudio(data) {
    return this.audioEngine.feedExternalAudio(data);
  }
  // Connect-owned media extension. Audio state/signaling remain in the proven session.
  initVideoStreams(selfDeviceJid, peerDeviceJid) {
    if (this.info.mediaType !== CallMediaType.Video) return;
    const slots = [0, 1, 4, 2, 3, 5, 7, 8, 6];
    this.selfStreamSsrcs = slots.map((slot) =>
      generateSecureSsrc(this.info.callId, this.ensureDeviceJid(selfDeviceJid), slot),
    );
    const ssrc = generateSecureSsrc(this.info.callId, this.ensureDeviceJid(selfDeviceJid), 2);
    if (!this.videoRtpSession || this.videoRtpSession.getSsrc() !== ssrc)
      this.videoRtpSession = new RtpSession(ssrc, 97, 90000, 3000);
    this.updateVideoPeer(peerDeviceJid);
  }
  updateVideoPeer(peerDeviceJid) {
    if (this.info.mediaType !== CallMediaType.Video) return;
    this.peerStreamSsrcs = [0, 1, 4, 2, 3, 5, 7, 8, 6].map((slot) =>
      generateSecureSsrc(this.info.callId, this.ensureDeviceJid(peerDeviceJid), slot),
    );
    this.peerVideoSsrc = generateSecureSsrc(this.info.callId, this.ensureDeviceJid(peerDeviceJid), 2);
    this.sctpRelay.setStreamSsrcs(this.selfStreamSsrcs, this.peerStreamSsrcs);
    this.sctpRelay.resendSubscriptions();
  }
  feedLiveVideo(data, timestampUs) {
    if (!(data instanceof Uint8Array) || !data.length || data.length > 8 * 1024 * 1024) return 0;
    if (!Number.isSafeInteger(timestampUs) || timestampUs < 0) return 0;
    if (
      this.info.mediaType !== CallMediaType.Video ||
      !this.info.isActive ||
      !this.videoRtpSession ||
      !this.srtpSession ||
      !this.sctpRelay.hasConnection()
    )
      return 0;
    // Browser timers round a 30 fps interval to 33 ms. Keep a 2 ms tolerance
    // without admitting 60 fps or a same-timestamp burst.
    if (this.lastVideoCaptureUs !== null && timestampUs - this.lastVideoCaptureUs < 1000000 / this.maxVideoFps - 2000)
      return 0;
    const estimatedWireBytes = data.length + Math.ceil(data.length / 798) * 48;
    if (!this.sctpRelay.canSendVideo(estimatedWireBytes)) return 0;
    const payloads = packetizeWhatsAppH264AccessUnit(data);
    if (!payloads.length) return 0;
    const timestamp = Math.floor(timestampUs * 0.09) >>> 0;
    const keyFrame = this.isH264KeyFrame(data);
    let sent = 0;
    for (let index = 0; index < payloads.length; index++) {
      const packet = this.videoRtpSession.createPacketAtTimestamp(
        payloads[index],
        timestamp,
        index === payloads.length - 1,
      );
      packet.header.extension = true;
      packet.header.extensionProfile = 0xdebe;
      packet.header.extensionData = this.buildVideoExtension(keyFrame, index === 0, this.videoTransportSequence++);
      const encrypted = this.srtpSession.protect(packet);
      if (!this.sctpRelay.broadcastVideo(toArrayBuffer(encrypted))) break;
      sent++;
      this.videoPacketCount++;
      this.videoOctetCount += payloads[index].length;
    }
    if (sent) {
      this.lastVideoCaptureUs = timestampUs;
      this.lastVideoRtpTimestamp = timestamp;
      this.lastVideoSentAt = Date.now();
      this.videoFrameNumber = (this.videoFrameNumber + 1) & 0xffff;
    }
    if (sent !== payloads.length) this.delegate.emitVideoKeyFrameRequest?.(this.info);
    return sent;
  }
  requestVideoKeyFrame() {
    if (
      this.info.mediaType !== CallMediaType.Video ||
      !this.info.isActive ||
      !this.sendSrtcp ||
      !this.videoRtpSession ||
      !this.peerVideoSsrc ||
      !this.sctpRelay.hasConnection()
    )
      return false;
    const now = Date.now();
    // Requests are event-driven: two spaced PLIs precede a FIR. No retry timer
    // is created; an authenticated IDR ends the pending recovery sequence.
    const sendFir = this.videoPliAttempts >= 2;
    if (now - this.lastVideoPliAt < (sendFir ? 750 : 500)) return false;
    this.lastVideoPliAt = now;
    const senderSsrc = this.videoRtpSession.getSsrc();
    const packet = sendFir
      ? buildFullIntraRequest(senderSsrc, this.peerVideoSsrc, this.videoFirSequence++)
      : buildPictureLossIndication(senderSsrc, this.peerVideoSsrc);
    this.sctpRelay.broadcast(toArrayBuffer(this.sendSrtcp.protect(packet, senderSsrc)));
    this.videoPliAttempts = sendFir ? 0 : this.videoPliAttempts + 1;
    return true;
  }
  onVideoRtcp(data) {
    if (!this.recvSrtcp || !this.videoRtpSession || !this.info.isActive) return;
    try {
      const plain = this.recvSrtcp.unprotect(data);
      const feedback = parseVideoKeyFrameFeedback(plain);
      if (
        feedback.some((entry) => entry.mediaSsrc === this.videoRtpSession.getSsrc()) &&
        Date.now() - this.lastVideoFeedbackAt >= 500
      ) {
        this.lastVideoFeedbackAt = Date.now();
        this.delegate.emitVideoKeyFrameRequest?.(this.info);
      }
    } catch {
      this.srtpErrorCount++;
    }
  }
  onVideoRtp(data, payloadType) {
    if (!this.srtpSession || !this.info.isActive || data.length < 12) return;
    try {
      const ssrc = readUInt32BE(data, 8);
      if (this.selfStreamSsrcs.includes(ssrc)) return;
      // Unknown SSRCs cannot mutate selected device/relay state.
      if (!this.peerStreamSsrcs.includes(ssrc)) return;
      const packet = this.srtpSession.unprotect(data);
      let payload = packet.payload;
      let sequenceNumber = packet.header.sequenceNumber;
      let mediaSsrc = packet.header.ssrc;
      if (payloadType === 103) {
        if (payload.length < 3) return;
        sequenceNumber = (payload[0] << 8) | payload[1];
        payload = payload.subarray(2);
        // One negotiated video track. RTX reuses the primary sequence/timestamp space.
        mediaSsrc = this.videoTimestampOwners.get(packet.header.timestamp) ?? this.peerVideoSsrc;
      } else {
        if (this.videoTimestampOwners.size >= 64 && !this.videoTimestampOwners.has(packet.header.timestamp))
          this.videoTimestampOwners.delete(this.videoTimestampOwners.keys().next().value);
        this.videoTimestampOwners.set(packet.header.timestamp, mediaSsrc);
      }
      let depacketizer = this.videoDepacketizers.get(mediaSsrc);
      if (!depacketizer) {
        if (this.videoDepacketizers.size >= 8) return;
        depacketizer = new H264Depacketizer();
        this.videoDepacketizers.set(mediaSsrc, depacketizer);
      }
      const frames = depacketizer.push(payload, packet.header.timestamp, packet.header.marker, sequenceNumber);
      for (const frame of frames) {
        if (!this.videoClock) this.videoClock = { last: frame.timestamp, ticks: 0 };
        const delta = (frame.timestamp - this.videoClock.last) | 0;
        if (delta < 0) continue;
        this.videoClock.ticks += delta;
        this.videoClock.last = frame.timestamp;
        if (frame.keyFrame) this.videoPliAttempts = 0;
        this.delegate.emitInboundVideo?.(this.info, {
          codec: 'h264',
          timestampUs: Math.round((this.videoClock.ticks * 1000) / 90),
          keyFrame: frame.keyFrame,
          data: frame.data,
        });
      }
      if (!frames.length && packet.header.marker) this.requestVideoKeyFrame();
    } catch {
      this.srtpErrorCount++;
      this.requestVideoKeyFrame();
    }
  }
  startVideoFeedback() {
    if (this.info.mediaType !== CallMediaType.Video || this.videoRtcpTimer) return;
    const cname = randomBytes(18);
    this.videoRtcpTimer = setInterval(() => {
      if (!this.info.isActive || !this.sendSrtcp || !this.videoRtpSession || this.lastVideoRtpTimestamp === null)
        return;
      const senderSsrc = this.videoRtpSession.getSsrc();
      const timestamp =
        (this.lastVideoRtpTimestamp + Math.floor(Math.max(0, Date.now() - this.lastVideoSentAt) * 90)) >>> 0;
      const report = buildSenderReportWithSdes(
        senderSsrc,
        this.videoPacketCount,
        this.videoOctetCount,
        timestamp,
        cname,
      );
      this.sctpRelay.broadcast(toArrayBuffer(this.sendSrtcp.protect(report, senderSsrc)));
    }, 1000);
    this.videoRtcpTimer.unref?.();
    this.videoSubscriptionTimer = setInterval(() => {
      if (this.info.isActive) this.sctpRelay.resendSubscriptions();
    }, 5000);
    this.videoSubscriptionTimer.unref?.();
    this.requestVideoKeyFrame();
  }
  isH264KeyFrame(data) {
    for (let index = 0; index + 4 < data.length; index++) {
      let nalOffset = -1;
      if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1) nalOffset = index + 3;
      else if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 0 && data[index + 3] === 1)
        nalOffset = index + 4;
      if (nalOffset >= 0 && nalOffset < data.length) {
        const nalType = data[nalOffset] & 0x1f;
        if (nalType === 5 || nalType === 7 || nalType === 8) return true;
      }
    }
    return false;
  }
  buildVideoExtension(keyFrame, firstPacket, transportSequence) {
    const frameInfo = keyFrame ? 0x08 : 0x20;
    const extension = new Uint8Array(firstPacket ? 16 : 12);
    let offset = 0;
    extension[offset++] = firstPacket ? 0x32 : 0x30;
    extension[offset++] = frameInfo;
    if (firstPacket) {
      extension[offset++] = (this.videoFrameNumber >>> 8) & 0xff;
      extension[offset++] = this.videoFrameNumber & 0xff;
    }
    extension[offset++] = 0x51;
    extension[offset++] = 0;
    extension[offset++] = 0;
    extension[offset++] = 0x61;
    extension[offset++] = 0;
    extension[offset++] = 0;
    extension[offset++] = 0x91;
    extension[offset++] = (transportSequence >>> 8) & 0xff;
    extension[offset++] = transportSequence & 0xff;
    return extension;
  }
  getLiveBufferMs() {
    return this.audioEngine.getLiveBufferMs();
  }
  async sendIncomingPreaccept(peerJid) {
    try {
      const preacceptNode = buildPreacceptStanza(peerJid, this.info.callId, this.info.callCreator);
      await this.deps.lowLevelCoordinator.sendNode(preacceptNode);
    } catch (err) {
      this.logger.error('error sending preaccept', {
        message: toError(err).message,
      });
    }
  }
  async sendIncomingRelayLatency() {
    if (!this.info.relayData) return;
    const meId = this.deps.authClient.getCurrentCredentials()?.meJid ?? '';
    const callId = this.info.callId;
    const callCreator = this.info.callCreator;
    const destinationJids = this.info.relayData.participantJids || [];
    const seenRelayNames = new Set();
    for (const ep of this.info.relayData.endpoints) {
      const name = ep.relayName || '';
      if (!name || seenRelayNames.has(name)) continue;
      seenRelayNames.add(name);
      try {
        const relayData = [
          {
            relayName: name,
            latency: ep.c2rRtt || 0,
            addressBytes: ep.addressBytes,
          },
        ];
        const relayLatencyNode = buildRelayLatencyStanza(
          this.info.peerJid,
          callId,
          callCreator,
          relayData,
          destinationJids,
          meId,
        );
        await this.deps.lowLevelCoordinator.sendNode(relayLatencyNode);
      } catch (err) {
        this.logger.error('error sending incoming relaylatency', {
          relayName: name,
          message: toError(err).message,
        });
      }
    }
  }
  async handleCallAccept(node, peerJid) {
    const nodeInfo = extractNodeInfo(node);
    if (!nodeInfo) return;
    if (
      this.info.isEnded ||
      !this.info.isInitiator ||
      this.acceptedByJid ||
      this.argwsAcceptInProgress ||
      this.argwsEndPromise ||
      this.info.stateData.state !== CallState.Ringing
    )
      return;
    this.argwsAcceptInProgress = true;
    try {
      if (await this.argwsIsOwnDevice(peerJid)) return;
      if (this.info.isEnded || this.argwsEndPromise) return;
      const acceptingDeviceJid = peerJid;
      let srtpFromPeerKey = false;
      if (needsDecryption(nodeInfo.tag)) {
        try {
          const peerCallKey = await decryptCallKey(
            this.deps,
            nodeInfo.innerNode,
            peerJid,
            this.logger.child({ component: 'signaling' }),
          );
          if (peerCallKey) {
            const ourCallKey = this.info.encryptionKey;
            const keysMatch = ourCallKey ? uint8TimingSafeEqual(ourCallKey, peerCallKey) : false;
            if (!keysMatch && ourCallKey) {
              const meLid = this.deps.authClient.getCurrentCredentials()?.meLid;
              const meJid = this.deps.authClient.getCurrentCredentials()?.meJid;
              const ourCredJid = meLid || meJid || '';
              const ourBase = ourCredJid ? toUserJid(ourCredJid) : '';
              const participants = this.info.relayData?.participantJids || [];
              const ourDeviceJid =
                participants.find((jid) => {
                  const jBase = toUserJid(jid);
                  return jBase === ourBase && /:\d+@/.test(jid);
                }) || ourCredJid;
              if (ourDeviceJid && peerJid) {
                try {
                  const sendKeying = derivePerJidSrtpKey(ourCallKey, this.ensureDeviceJid(ourDeviceJid));
                  const recvKeying = derivePerJidSrtpKey(peerCallKey, this.ensureDeviceJid(peerJid));
                  this.srtpSession = new SrtpSession(
                    sendKeying,
                    recvKeying,
                    SRTP_SEND_AUTH_TAG_LEN,
                    SRTP_RECV_AUTH_TAG_LEN,
                  );
                  if (this.info.mediaType === CallMediaType.Video) {
                    this.sendSrtcp = new SrtcpContext(sendKeying, SRTP_SEND_AUTH_TAG_LEN);
                    this.recvSrtcp = new SrtcpContext(recvKeying, SRTP_RECV_AUTH_TAG_LEN);
                  }
                  srtpFromPeerKey = true;
                  this.logger.debug('srtp re-initialized with peer call_key', {
                    callId: this.info.callId,
                  });
                } catch (err) {
                  this.logger.error('per-jid srtp re-derivation failed', {
                    message: toError(err).message,
                  });
                }
              }
            }
          }
        } catch (err) {
          this.logger.error('accept decrypt error', {
            message: toError(err).message,
          });
        }
      }
      if (this.info.isEnded || this.argwsEndPromise) return;
      this.acceptedByJid = acceptingDeviceJid;
      this.updateVideoPeer(acceptingDeviceJid);
      try {
        this.info.applyTransition({ type: 'remote_accepted' });
        this.delegate.emitState(this.info);
      } catch (err) {
        this.logger.trace('call transition skipped', { message: toError(err).message });
      }
      const meId = this.deps.authClient.getCurrentCredentials()?.meJid ?? '';
      const meLid = this.deps.authClient.getCurrentCredentials()?.meLid;
      const ourJid = meLid || meId;
      const callId = this.info.callId;
      const callCreator = this.info.callCreator;
      if (this.actualPeerSsrc !== null) {
        const calculatedJid = this.ensureDeviceJid(acceptingDeviceJid);
        this.logger.debug('accept keeping actual peer ssrc', {
          callId,
          actualPeerSsrc: `0x${this.actualPeerSsrc.toString(16)}`,
          calculatedJid,
        });
      } else {
        const peerDeviceJidForSsrc = this.ensureDeviceJid(acceptingDeviceJid);
        const acceptSsrc = generateSecureSsrc(callId, peerDeviceJidForSsrc);
        this.peerSsrcs = [acceptSsrc];
        this.logger.debug('accept ssrc assigned', {
          callId,
          jid: peerDeviceJidForSsrc,
          ssrc: `0x${acceptSsrc.toString(16)}`,
        });
      }
      this.sctpRelay.setSubscriptionSsrc(this.peerSsrcs[0] ?? 0);
      this.sctpRelay.resendSubscriptions();
      if (!srtpFromPeerKey) {
        this.initSrtpKeys();
      }
      {
        const otherDevices = await this.argwsOtherDevices(acceptingDeviceJid);
        if (this.info.isEnded || this.argwsEndPromise) return;
        for (const deviceJid of otherDevices) {
          if (this.info.isEnded || this.argwsEndPromise) return;
          try {
            const terminateNode = buildTerminateStanza(deviceJid, callId, callCreator, undefined, 'accepted_elsewhere');
            await this.deps.lowLevelCoordinator.sendNode(terminateNode);
          } catch (err) {
            this.logger.error('error sending terminate_elsewhere', {
              deviceJid,
              message: toError(err).message,
            });
          }
        }
      }
      if (this.info.isEnded || this.argwsEndPromise) return;
      try {
        const transportNode = buildTransportStanza(acceptingDeviceJid, callId, callCreator, meId, '1', '1');
        await this.deps.lowLevelCoordinator.sendNode(transportNode);
      } catch (err) {
        this.logger.error('error sending transport', {
          message: toError(err).message,
        });
      }
      try {
        const muteNode = buildMuteV2Stanza(acceptingDeviceJid, callId, callCreator, 0, meId);
        await this.deps.lowLevelCoordinator.sendNode(muteNode);
      } catch (err) {
        this.logger.error('error sending mute_v2', {
          message: toError(err).message,
        });
      }
      const acceptMsgId = node.attrs?.id;
      if (acceptMsgId) {
        try {
          const receiptNode = buildAcceptReceiptStanza(acceptingDeviceJid, acceptMsgId, callId, callCreator, ourJid);
          await this.deps.lowLevelCoordinator.sendNode(receiptNode);
        } catch (err) {
          this.logger.error('error sending accept receipt', {
            message: toError(err).message,
          });
        }
      }
      if (this.info.isEnded || this.argwsEndPromise) return;
      if (this.sctpRelay.hasConnection()) {
        try {
          this.info.applyTransition({ type: 'media_connected' });
          this.delegate.emitState(this.info);
          this.startMediaFlow();
        } catch (err) {
          this.logger.trace('call transition skipped', { message: toError(err).message });
        }
      } else if (this.info.relayData) {
        await this.connectRelays(this.info.relayData.endpoints);
      }
    } finally {
      this.argwsAcceptInProgress = false;
    }
  }
  async handleCallPreaccept(node, peerJid) {
    const nodeInfo = extractNodeInfo(node);
    if (!nodeInfo) return;
    if (this.info.direction === CallDirection.Outgoing && this.info.relayData) {
      const meId = this.deps.authClient.getCurrentCredentials()?.meJid ?? '';
      const callId = this.info.callId;
      const callCreator = this.info.callCreator;
      const destinationJids = this.info.relayData.participantJids || [];
      const seenRelayNames = new Set();
      for (const ep of this.info.relayData.endpoints) {
        const name = ep.relayName || '';
        if (!name || seenRelayNames.has(name)) continue;
        seenRelayNames.add(name);
        try {
          const relayData = [
            {
              relayName: name,
              latency: ep.c2rRtt || 0,
              addressBytes: ep.addressBytes,
            },
          ];
          const relayLatencyNode = buildRelayLatencyStanza(
            this.info.peerJid,
            callId,
            callCreator,
            relayData,
            destinationJids,
            meId,
          );
          await this.deps.lowLevelCoordinator.sendNode(relayLatencyNode);
        } catch (err) {
          this.logger.error('error sending relaylatency', {
            relayName: name,
            message: toError(err).message,
          });
        }
      }
      if (!this.initialTransportSent) {
        try {
          const basePeerJid = toUserJid(peerJid);
          const transportNode = buildTransportStanza(basePeerJid, callId, callCreator, meId);
          await this.deps.lowLevelCoordinator.sendNode(transportNode);
          this.initialTransportSent = true;
        } catch (err) {
          this.logger.error('error sending initial transport', {
            message: toError(err).message,
          });
        }
      }
    }
  }
  async handleCallTransport(_node) {
    const nodeInfo = extractNodeInfo(_node);
    if (!nodeInfo) return;
    const relays = extractRelayEndpoints(nodeInfo.innerNode);
    if (relays.length > 0 && !this.sctpRelay.hasConnection()) {
      this.info.relayData = {
        ...this.info.relayData,
        endpoints: relays,
      };
      await this.connectRelays(relays);
    }
  }
  async handleCallAck(node) {
    if (this.info.isEnded) return;
    const ackType = node.attrs?.type;
    if (ackType !== 'offer') return;
    const error = node.attrs?.error;
    if (error) {
      this.logger.error('ack error', { callId: this.info.callId, error });
      return;
    }
    const { relays, participantJids, uuid, selfPid, peerPid, hbhKey } = parseRelayFromAck(node);
    if (relays.length > 0) {
      this.info.relayData = {
        endpoints: relays,
        participantJids,
        uuid,
        selfPid,
        peerPid,
        hbhKey,
      };
      this.logger.debug('offer ack relays parsed', {
        callId: this.info.callId,
        relayCount: relays.length,
        participantCount: participantJids.length,
      });
      const callKey = this.info.encryptionKey;
      // A late offer ACK must not replace the accepted device or its negotiated media keys.
      if (participantJids.length > 0 && !this.acceptedByJid) {
        const meLid = this.deps.authClient.getCurrentCredentials()?.meLid;
        const meId = this.deps.authClient.getCurrentCredentials()?.meJid;
        const ourCredJid = meLid || meId || '';
        const ourBase = ourCredJid ? toUserJid(ourCredJid) : '';
        const ourDeviceJid = this.ensureDeviceJid(
          participantJids.find((jid) => {
            const jidBase = toUserJid(jid);
            return jidBase === ourBase && /:\d+@/.test(jid);
          }) || ourCredJid,
        );
        const peerJids = participantJids.filter((jid) => {
          const jidBase = toUserJid(jid);
          return jidBase !== ourBase;
        });
        const peerDeviceJid = peerJids[0] ? this.ensureDeviceJid(peerJids[0]) : undefined;
        const newSelfSsrc = generateSecureSsrc(this.info.callId, ourDeviceJid);
        if (newSelfSsrc !== this.selfSsrc) {
          this.selfSsrc = newSelfSsrc;
          this.rtpSession = RtpSession.whatsappOpus(newSelfSsrc);
        }
        if (peerDeviceJid) {
          const peerDeviceSsrc = generateSecureSsrc(this.info.callId, peerDeviceJid);
          this.peerSsrcs = [peerDeviceSsrc];
        }
        this.initVideoStreams(ourDeviceJid, peerDeviceJid || this.info.peerJid);
        if (callKey) {
          this.initSrtpKeys();
        } else {
          this.logger.debug('no call_key, srtp not initialized', {
            callId: this.info.callId,
          });
        }
      }
      if (this.info.isInitiator && !this.outgoingPreacceptSent) {
        try {
          const preacceptNode = buildPreacceptStanza(this.info.peerJid, this.info.callId, this.info.callCreator);
          await this.deps.lowLevelCoordinator.sendNode(preacceptNode);
          this.outgoingPreacceptSent = true;
        } catch (err) {
          this.logger.error('error sending preaccept (caller)', {
            message: toError(err).message,
          });
        }
      }
      await this.connectRelays(relays);
      if (this.srtpSession && this.rtpSession && this.opusCodec && this.sctpRelay.hasConnection()) {
        this.audioEngine.startSilenceCapture();
      }
    }
  }
  // ACK every received control stanza, but share concurrent replies and suppress
  // reflected responses within a bounded window. Pending sends survive rollover.
  async argwsSendSignalingResponse(node, peerJid, incoming) {
    if (this.info.isEnded) return;
    const normalize = (value) => {
      if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('hex') };
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, normalize(value[key])]),
        );
      }
      return value;
    };
    // Outer stanza ids change on every echo and are deliberately excluded.
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          normalize({
            peerJid,
            incoming,
            to: node.attrs.to,
            content: node.content,
          }),
        ),
      )
      .digest('hex');
    const tag = node.content[0].tag;
    this.argwsSignalingResponses ??= new Map();
    let responses = this.argwsSignalingResponses.get(tag);
    if (!responses) {
      responses = { windowStart: Date.now(), sent: new Set(), pending: new Map(), warned: false };
      this.argwsSignalingResponses.set(tag, responses);
    }
    const refreshWindow = () => {
      const now = Date.now();
      if (now - responses.windowStart >= 60000 || now < responses.windowStart) {
        responses.windowStart = now;
        responses.sent.clear();
        responses.warned = false;
      }
    };
    refreshWindow();
    const pending = responses.pending.get(fingerprint);
    if (pending) return pending;
    if (responses.sent.has(fingerprint)) return;
    // Count pending sends across windows so slow transport cannot grow memory.
    if (responses.sent.size + responses.pending.size >= 256) {
      if (!responses.warned) {
        responses.warned = true;
        this.logger.warn('call control response deduplication limit reached', { callId: this.info.callId });
      }
      return;
    }
    // Defer transport until the shared promise is reserved, covering reentrancy.
    const sending = Promise.resolve().then(async () => {
      try {
        if (this.info.isEnded) return;
        await this.deps.lowLevelCoordinator.sendNode(node);
        refreshWindow();
        responses.sent.add(fingerprint);
      } finally {
        responses.pending.delete(fingerprint);
      }
    });
    responses.pending.set(fingerprint, sending);
    return sending;
  }
  async handleCallRelaylatency(node, peerJid) {
    const nodeInfo = extractNodeInfo(node);
    if (!nodeInfo) return;
    const inner = nodeInfo.innerNode;
    const callId = inner.attrs?.['call-id'] || this.info.callId;
    const callCreator = inner.attrs?.['call-creator'] || this.info.callCreator;
    const teNodes = getNodeChildrenByTag(inner, 'te');
    if (teNodes.length === 0) return;
    const destinationJids = this.info.relayData?.participantJids || [];
    if (destinationJids.length > 0) {
      const forwardNode = buildRelaylatencyForwardStanza(peerJid, callId, callCreator, teNodes, destinationJids);
      try {
        await this.argwsSendSignalingResponse(forwardNode, peerJid, inner);
      } catch (err) {
        this.logger.error('error forwarding relaylatency', {
          message: toError(err).message,
        });
      }
    }
  }
  handleRelayElection(node) {
    const inner = getFirstNodeChild(node);
    if (!inner) return;
    let electedRelayIdx;
    if (inner.attrs?.['elected_relay_idx'] !== undefined) {
      const parsed = Number(inner.attrs['elected_relay_idx']);
      if (Number.isSafeInteger(parsed) && parsed >= 0) electedRelayIdx = parsed;
    } else if (inner.attrs?.['relay_id'] !== undefined) {
      const parsed = Number(inner.attrs['relay_id']);
      if (Number.isSafeInteger(parsed) && parsed >= 0) electedRelayIdx = parsed;
    } else if (inner.content instanceof Uint8Array) {
      const bytes = inner.content;
      if (bytes.length >= 4) electedRelayIdx = readUInt32BE(bytes, 0);
      else if (bytes.length > 0) electedRelayIdx = bytes[0];
    }
    if (electedRelayIdx !== undefined) {
      this.info.electedRelayIdx = electedRelayIdx;
      this.logger.debug('elected relay index', {
        callId: this.info.callId,
        electedRelayIdx,
      });
    }
  }
  async handleCallMuteV2(node, peerJid) {
    const nodeInfo = extractNodeInfo(node);
    if (!nodeInfo) return;
    const meId = this.deps.authClient.getCurrentCredentials()?.meJid ?? '';
    const callId = this.info.callId;
    const callCreator = this.info.callCreator;
    try {
      const muteNode = buildMuteV2Stanza(peerJid, callId, callCreator, 0, meId);
      await this.argwsSendSignalingResponse(muteNode, peerJid, nodeInfo.innerNode);
    } catch (err) {
      this.logger.error('error sending mute_v2 response', {
        message: toError(err).message,
      });
    }
  }
  handleCallTerminate(reason = EndCallReason.UserEnded) {
    if (this.info.isEnded) return;
    try {
      this.info.applyTransition({
        type: 'terminated',
        reason,
      });
    } catch (err) {
      this.logger.trace('call transition skipped', { message: toError(err).message });
    }
    this.delegate.emitEnded(this.info);
    this.delegate.emitState(this.info);
    this.cleanup();
  }
  sendCapturedAudio(data) {
    const hasRelay = this.sctpRelay.hasConnection();
    if (!this.rtpSession || !this.srtpSession || !this.opusCodec || !hasRelay) {
      this.audioDropCount++;
      if (this.audioDropCount === 1 || this.audioDropCount % 500 === 0) {
        const missing = [
          !this.rtpSession && 'rtpSession',
          !this.srtpSession && 'srtpSession',
          !this.opusCodec && 'opusCodec',
          !hasRelay && 'relayConnection',
        ]
          .filter(Boolean)
          .join(', ');
        this.logger.debug('audio dropped', {
          callId: this.info.callId,
          dropCount: this.audioDropCount,
          missing,
        });
      }
      return;
    }
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) {
        data[i] = 0;
      }
    }
    const frameSamples = this.encodeFrameSamples;
    if (!this.encodeBuffer) {
      if (!this.encodeBufferA) {
        this.encodeBufferA = new Float32Array(frameSamples);
        this.encodeBufferB = new Float32Array(frameSamples);
      }
      this.encodeBuffer = this.encodeBufferA;
      this.encodeBufferPos = 0;
    }
    let offset = 0;
    while (offset < data.length) {
      const toCopy = Math.min(data.length - offset, frameSamples - this.encodeBufferPos);
      this.encodeBuffer.set(data.subarray(offset, offset + toCopy), this.encodeBufferPos);
      this.encodeBufferPos += toCopy;
      offset += toCopy;
      if (this.encodeBufferPos < frameSamples) break;
      const frameData = this.encodeBuffer;
      this.encodeBuffer = frameData === this.encodeBufferA ? this.encodeBufferB : this.encodeBufferA;
      this.encodeBufferPos = 0;
      try {
        const opusFrame = this.opusCodec.encode(frameData);
        this.sendOpusFrame(opusFrame, false);
        this.realAudioSendCount++;
      } catch (err) {
        this.logger.error('encode error', {
          callId: this.info.callId,
          message: toError(err).message,
        });
      }
    }
  }
  cleanup() {
    const opusStats = this.opusCodec?.getStats();
    this.logger.debug('call stats', {
      callId: this.info.callId,
      relayPackets: this.relayPacketCount,
      recvOk: this.audioRecvCount,
      srtpErrors: this.srtpErrorCount,
      sent: this.audioSendCount,
      dropped: this.audioDropCount,
      opusOk: opusStats?.success ?? 0,
      opusErr: opusStats?.errors ?? 0,
    });
    this.audioEngine.setOnAudioFinished(null);
    this.audioEngine.stop();
    clearInterval(this.videoRtcpTimer);
    clearInterval(this.videoSubscriptionTimer);
    this.videoRtcpTimer = null;
    this.videoSubscriptionTimer = null;
    for (const depacketizer of this.videoDepacketizers.values()) depacketizer.reset();
    this.videoDepacketizers.clear();
    this.videoTimestampOwners.clear();
    this.videoRtpSession = null;
    this.sendSrtcp = null;
    this.recvSrtcp = null;
    this.selfStreamSsrcs = [];
    this.peerStreamSsrcs = [];
    this.lastVideoCaptureUs = null;
    this.lastVideoRtpTimestamp = null;
    this.videoClock = null;
    this.videoPliAttempts = 0;
    this.videoFirSequence = 0;
    this.lastVideoPliAt = -Infinity;
    this.lastVideoFeedbackAt = -Infinity;
    this.sctpRelay.cleanup();
    if (this.opusCodec) {
      this.opusCodec.destroy();
      this.opusCodec = null;
    }
    this.rtpSession = null;
    this.srtpSession = null;
    this.audioSendCount = 0;
    this.audioDropCount = 0;
    this.audioRecvCount = 0;
    this.srtpErrorCount = 0;
    this.relayPacketCount = 0;
    this.stunResponseCount = 0;
    this.selfEchoCount = 0;
    this.lastRecvSeq = -1;
    this.recvSeqGaps = 0;
    this.actualPeerSsrc = null;
    this.ssrcResubscribed = false;
    this.recvRealCount = 0;
    this.recvDtxCount = 0;
    this.initialTransportSent = false;
    this.outgoingPreacceptSent = false;
    this.firstPacketSent = false;
    this.realAudioSendCount = 0;
    this.encodeBuffer = null;
    this.encodeBufferPos = 0;
    this.acceptedByJid = null;
  }
  get encodeFrameSamples() {
    return this.opusCodec?.getFrameSize() ?? 960;
  }
  get rtpTsDelta() {
    return this.encodeFrameSamples;
  }
  sendOpusFrame(opusFrame, isSilence) {
    if (!this.rtpSession || !this.srtpSession) return;
    try {
      let rtpPayload = opusFrame;
      const authPadding = SRTP_AUTH_TAG_LEN - SRTP_SEND_AUTH_TAG_LEN;
      if (authPadding > 0) {
        if (!this.authPaddingBuffer || this.authPaddingBuffer.length !== authPadding) {
          this.authPaddingBuffer = new Uint8Array(authPadding);
        }
        rtpPayload = concatBytes([rtpPayload, this.authPaddingBuffer]);
      }
      const marker = !this.firstPacketSent;
      const tsDelta = this.rtpTsDelta;
      const rtpPacket = this.rtpSession.createPacketWithDuration(rtpPayload, tsDelta, marker);
      if (this.debeEnabled) {
        rtpPacket.header.extension = true;
        rtpPacket.header.extensionProfile = 0xdebe;
        rtpPacket.header.extensionData = WaCallMediaSession.EMPTY_BYTES;
      }
      if (!this.firstPacketSent) {
        this.firstPacketSent = true;
      }
      const srtpData = this.srtpSession.protect(rtpPacket);
      this.sctpRelay.broadcast(toArrayBuffer(srtpData));
      this.audioSendCount++;
      if (this.audioSendCount === 1 || this.audioSendCount % 500 === 0) {
        this.logger.debug('audio sent', {
          callId: this.info.callId,
          sendCount: this.audioSendCount,
          opusBytes: opusFrame.length,
          srtpBytes: srtpData.length,
          silence: isSilence,
        });
      }
    } catch (err) {
      this.logger.error('error sending audio', {
        callId: this.info.callId,
        message: toError(err).message,
      });
    }
  }
  ensureDeviceJid(jid) {
    if (/:\d+@/.test(jid)) return jid;
    return jid.replace('@', ':0@');
  }
  initSrtpKeys() {
    const callKey = this.info.encryptionKey;
    if (!callKey) {
      this.logger.debug('no call_key, srtp not initialized', { callId: this.info.callId });
      return;
    }
    const meLid = this.deps.authClient.getCurrentCredentials()?.meLid;
    const meId = this.deps.authClient.getCurrentCredentials()?.meJid;
    const ourCredJid = meLid || meId || '';
    const ourBase = toUserJid(ourCredJid);
    const participants = this.info.relayData?.participantJids || [];
    const ourDeviceJid = this.ensureDeviceJid(
      participants.find((jid) => {
        const jBase = toUserJid(jid);
        return jBase === ourBase && /:\d+@/.test(jid);
      }) || ourCredJid,
    );
    let rawPeerJid = this.acceptedByJid || this.info.peerJid;
    if (!this.acceptedByJid) {
      const peerFromParticipants = participants.find((jid) => {
        const jBase = toUserJid(jid);
        return jBase !== ourBase;
      });
      if (peerFromParticipants) rawPeerJid = peerFromParticipants;
    }
    const peerDeviceJid = this.ensureDeviceJid(rawPeerJid);
    try {
      const sendKeying = derivePerJidSrtpKey(callKey, ourDeviceJid);
      const recvKeying = derivePerJidSrtpKey(callKey, peerDeviceJid);
      this.srtpSession = new SrtpSession(sendKeying, recvKeying, SRTP_SEND_AUTH_TAG_LEN, SRTP_RECV_AUTH_TAG_LEN);
      if (this.info.mediaType === CallMediaType.Video) {
        this.sendSrtcp = new SrtcpContext(sendKeying, SRTP_SEND_AUTH_TAG_LEN);
        this.recvSrtcp = new SrtcpContext(recvKeying, SRTP_RECV_AUTH_TAG_LEN);
      }
      this.logger.debug('srtp per-jid keys initialized', {
        callId: this.info.callId,
        sendJid: ourDeviceJid,
        recvJid: peerDeviceJid,
      });
    } catch (err) {
      this.logger.debug('srtp key derivation failed', {
        callId: this.info.callId,
        message: toError(err).message,
      });
    }
  }
  resetEncodeState() {
    this.encodeBuffer = null;
    this.encodeBufferPos = 0;
    this.realAudioSendCount = 0;
  }
  onRelayConnected() {
    if (this.info.stateData.state === CallState.Connecting) {
      try {
        this.info.applyTransition({ type: 'media_connected' });
        this.delegate.emitState(this.info);
        this.startMediaFlow();
        this.logger.debug('relay connected, call active', { callId: this.info.callId });
      } catch (err) {
        this.logger.trace('call transition skipped', { message: toError(err).message });
      }
    }
  }
  onRelayData(data) {
    this.relayPacketCount++;
    if (isStunPacket(data)) {
      this.stunResponseCount++;
      return;
    }
    if (
      this.info.mediaType === CallMediaType.Video &&
      data.length >= 8 &&
      (data[0] & 0xc0) === 0x80 &&
      data[1] >= 192 &&
      data[1] <= 223
    ) {
      this.onVideoRtcp(data);
      return;
    }
    if (!isRtpPacket(data)) return;
    const pt = data[1] & 0x7f;
    if (this.info.mediaType === CallMediaType.Video && (pt === 97 || pt === 103)) {
      this.onVideoRtp(data, pt);
      return;
    }
    if (!this.srtpSession || !this.opusCodec) return;
    if (pt !== 120) return;
    if (data.length >= 12) {
      const ssrc = ((data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11]) >>> 0;
      if (ssrc === this.selfSsrc) {
        this.selfEchoCount++;
        return;
      }
      if (!this.ssrcResubscribed && this.actualPeerSsrc === null) {
        this.actualPeerSsrc = ssrc;
        const knownSsrc = this.peerSsrcs.includes(ssrc);
        if (!knownSsrc) {
          this.peerSsrcs = [ssrc];
          this.ssrcResubscribed = true;
          this.sctpRelay.setSubscriptionSsrc(this.peerSsrcs[0] ?? 0);
          this.sctpRelay.resendSubscriptions();
        }
      }
    }
    try {
      const rtpPacket = this.srtpSession.unprotect(data);
      const opusPayload = rtpPacket.payload;
      this.audioRecvCount++;
      if (opusPayload.length === 0) return;
      const seq = rtpPacket.header.sequenceNumber;
      if (this.lastRecvSeq >= 0) {
        const expected = (this.lastRecvSeq + 1) & 0xffff;
        if (seq !== expected) {
          const gap = ((seq - this.lastRecvSeq + 65536) % 65536) - 1;
          this.recvSeqGaps += gap;
        }
      }
      this.lastRecvSeq = seq;
      const isDtx = opusPayload.length <= 2;
      if (isDtx) this.recvDtxCount++;
      else this.recvRealCount++;
      let audioData = this.opusCodec.decode(opusPayload);
      if (audioData.length > 0 && audioData.length < 960) {
        const padded = new Float32Array(960);
        padded.set(audioData);
        audioData = padded;
      }
      this.audioEngine.onPlaybackData(audioData);
      this.delegate.emitInboundAudio(this.info, audioData);
      if (this.audioRecvCount % 100 === 0) {
        const stats = this.opusCodec.getStats();
        this.logger.debug('audio recv stats', {
          callId: this.info.callId,
          recvCount: this.audioRecvCount,
          real: this.recvRealCount,
          dtx: this.recvDtxCount,
          decodeOk: stats.success,
          decodeErr: stats.errors,
        });
      }
    } catch (err) {
      this.srtpErrorCount++;
      if (this.srtpErrorCount <= 5) {
        const ssrc = data.length >= 12 ? readUInt32BE(data, 8) : 0;
        this.logger.debug('srtp recv error', {
          callId: this.info.callId,
          errorCount: this.srtpErrorCount,
          message: toError(err).message,
          ssrc: `0x${ssrc.toString(16)}`,
        });
      }
    }
  }
  async connectRelays(endpoints) {
    this.logger.debug('connecting relays', {
      callId: this.info.callId,
      endpointCount: endpoints.length,
    });
    const seen = new Set();
    const uniqueEndpoints = [];
    for (const ep of endpoints) {
      if ((ep.protocol ?? 0) !== 0) continue;
      const key = `${ep.ip}:${ep.port}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEndpoints.push(ep);
      }
    }
    const WA_RELAY_PORT = 3478;
    const relays = uniqueEndpoints
      .filter((ep) => ep.key && ep.rawToken)
      .map((ep) => ({
        ip: ep.ip,
        port: WA_RELAY_PORT,
        token: ep.token,
        authToken: ep.authToken,
        rawAuthToken: ep.rawAuthToken,
        rawToken: ep.rawToken,
        key: ep.key,
        relayId: ep.relayId,
        name: ep.relayName || `${ep.ip}:${WA_RELAY_PORT}`,
        authTokenId: ep.authTokenId,
        isFna: ep.isFna,
      }));
    if (relays.length === 0) {
      this.logger.error('no relay configs', { callId: this.info.callId });
      return;
    }
    this.sctpRelay.setSsrc(this.selfSsrc);
    this.sctpRelay.setSubscriptionSsrc(this.peerSsrcs[0] ?? 0);
    if (this.info.mediaType === CallMediaType.Video) {
      this.sctpRelay.setStreamSsrcs(this.selfStreamSsrcs, this.peerStreamSsrcs);
      this.sctpRelay.setParticipantIds(this.info.relayData?.selfPid, this.info.relayData?.peerPid);
    }
    try {
      await this.sctpRelay.configureRelays(relays);
      this.logger.debug('sctp relays configured', {
        callId: this.info.callId,
        connected: this.sctpRelay.getConnectedCount(),
      });
    } catch (err) {
      this.logger.error('sctp relay error', {
        callId: this.info.callId,
        message: toError(err).message,
      });
    }
  }
  startMediaFlow() {
    this.resetEncodeState();
    this.audioEngine.startPlayback();
    this.audioEngine.startCapture();
    this.startVideoFeedback();
  }
}
WaCallMediaSession.EMPTY_BYTES = EMPTY_BYTES;
