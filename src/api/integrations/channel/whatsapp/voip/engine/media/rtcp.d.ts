export declare function buildSenderReportWithSdes(
  ssrc: number,
  packetCount: number,
  octetCount: number,
  rtpTimestamp: number,
  cname?: Uint8Array,
): Uint8Array;
export declare function buildPictureLossIndication(
  senderSsrc: number,
  mediaSsrc: number,
  whatsappVideoProfile?: boolean,
): Uint8Array;
export declare function buildFullIntraRequest(
  senderSsrc: number,
  mediaSsrc: number,
  sequenceNumber: number,
): Uint8Array;
export interface VideoKeyFrameFeedback {
  type: 'pli' | 'fir';
  senderSsrc: number;
  mediaSsrc: number;
  sequenceNumber?: number;
}
export declare function validateRtcpCompound(data: Uint8Array): void;
export declare function parseVideoKeyFrameFeedback(data: Uint8Array): VideoKeyFrameFeedback[];
