export class Metadata {
  number: string;
}

export class OfferCallDto extends Metadata {
  isVideo?: boolean;
  /** Optional automatic hangup timeout in seconds. Omit for a normal PBX-managed call. */
  callDuration?: number;
}

export class CallIdDto {
  callId: string;
}

export class MuteCallDto extends CallIdDto {
  muted: boolean;
}
