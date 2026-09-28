import { randomUUID } from 'crypto';

export type FindHubFlowKind =
  | 'mcs.frame'
  | 'fcm.payload'
  | 'device.update'
  | 'location.decoded'
  | 'location.observed'
  | 'tracking.update'
  | 'connection.update'
  | 'devices.updated'
  | 'error'
  | (string & {});

export interface FindHubMcsFrame {
  tag: number;
  payloadBytes: number;
  streamId: number;
  receivedAt: string;
  appDataKeys?: string[];
  persistentIdFingerprint?: string;
  rawDataBytes?: number;
}

export interface FindHubFcmPayloadMetadata {
  receivedAt: string;
  payloadBytes: number;
  appDataKeys?: string[];
  persistentIdFingerprint?: string;
  rawDataBytes?: number;
}

export interface FindHubFlowEvent {
  eventId: string;
  sequence: number;
  kind: FindHubFlowKind;
  at: string;
  instanceId: string;
  instanceName: string;
  data: Record<string, unknown>;
}

export interface FindHubFlowSnapshot {
  version: 1;
  instanceId: string;
  instanceName: string;
  connected: boolean;
  state: string;
  sequence: number;
  dropped: number;
  bufferSize: number;
  bufferLimit: number;
  events: FindHubFlowEvent[];
}

export type FindHubFlowListener = (event: FindHubFlowEvent) => void;

export interface FindHubFlowPublishInput {
  kind: FindHubFlowKind;
  instanceId: string;
  instanceName: string;
  data?: Record<string, unknown>;
  at?: string;
}

const DEFAULT_FLOW_BUFFER_SIZE = 256;
const MIN_FLOW_BUFFER_SIZE = 32;
const MAX_FLOW_BUFFER_SIZE = 4096;

function boundedInteger(value: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(MAX_FLOW_BUFFER_SIZE, Math.max(MIN_FLOW_BUFFER_SIZE, value));
}

export function findHubFlowBufferSize(): number {
  const configured = Number(process.env.FINDHUB_FLOW_BUFFER_SIZE || DEFAULT_FLOW_BUFFER_SIZE);
  return boundedInteger(configured, DEFAULT_FLOW_BUFFER_SIZE);
}

/**
 * In-memory ring buffer for live protocol diagnostics.
 *
 * It deliberately never persists raw MCS/FCM frames. The buffer is bounded so
 * an idle or slow monitor cannot grow the Connect|API process indefinitely.
 */
export class FindHubFlowBuffer {
  private readonly events: FindHubFlowEvent[] = [];
  private readonly listeners = new Set<FindHubFlowListener>();
  private sequence = 0;
  private dropped = 0;

  public readonly limit: number;

  constructor(limit = DEFAULT_FLOW_BUFFER_SIZE) {
    this.limit = boundedInteger(limit, DEFAULT_FLOW_BUFFER_SIZE);
  }

  public publish(input: FindHubFlowPublishInput): FindHubFlowEvent {
    const event: FindHubFlowEvent = {
      eventId: randomUUID(),
      sequence: ++this.sequence,
      kind: input.kind,
      at: input.at || new Date().toISOString(),
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      data: { ...(input.data || {}) },
    };

    if (this.events.length >= this.limit) {
      this.events.shift();
      this.dropped++;
    }
    this.events.push(event);

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken monitor must not interrupt protocol processing or other readers.
      }
    }
    return event;
  }

  public snapshot(
    limit = this.limit,
  ): Omit<FindHubFlowSnapshot, 'instanceId' | 'instanceName' | 'connected' | 'state'> {
    const requested = Number.isInteger(limit) ? Math.max(1, Math.min(this.limit, limit)) : this.limit;
    return {
      version: 1,
      sequence: this.sequence,
      dropped: this.dropped,
      bufferSize: this.events.length,
      bufferLimit: this.limit,
      events: this.events.slice(-requested).map((event) => ({
        ...event,
        data: { ...event.data },
      })),
    };
  }

  public subscribe(listener: FindHubFlowListener): () => void {
    this.listeners.add(listener);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.listeners.delete(listener);
    };
  }
}
