export interface H264AccessUnit {
  readonly timestamp: number;
  readonly data: Uint8Array;
  readonly keyFrame: boolean;
}

export declare function packetizeH264AnnexB(data: Uint8Array, maxPayload?: number): Uint8Array[];
export declare function packetizeWhatsAppH264AccessUnit(data: Uint8Array, maxPayload?: number): Uint8Array[];

/** Retains at most 8 MiB per access unit and discards incomplete/lost FU-A frames. */
export declare class H264Depacketizer {
  push(payload: Uint8Array, timestamp: number, marker: boolean, sequenceNumber?: number): H264AccessUnit[];
  reset(): void;
  dispose(): void;
}
