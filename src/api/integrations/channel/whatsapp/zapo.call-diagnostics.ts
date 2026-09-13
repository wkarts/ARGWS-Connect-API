import { createHash } from 'crypto';

const boundClients = new WeakSet<object>();
const ATTRIBUTES = [
  'id',
  'class',
  'type',
  'from',
  'to',
  'jid',
  'call-id',
  'call-creator',
  'participant',
  'reason',
  'error',
  'code',
] as const;
const ERROR_ATTRIBUTES = ['code', 'error', 'reason', 'type'] as const;
// Only protocol enums are retained; these attributes must never become free-text fields.
const MEDIA_ATTRIBUTES: Record<string, Record<string, readonly string[]>> = {
  audio: { enc: ['opus', 'speex', 'amr', 'amr-wb'], rate: ['8000', '12000', '16000', '24000', '32000', '48000'] },
  net: { medium: ['0', '1', '2', '3'] },
  encopt: { keygen: ['1', '2'] },
};
const CALL_TAGS = new Set([
  'offer',
  'accept',
  'preaccept',
  'terminate',
  'reject',
  'transport',
  'relaylatency',
  'relay_election',
  'mute_v2',
]);
const MAX_VALUE_LENGTH = 160;
const MAX_NODES = 48;
const MAX_CHILDREN = 12;
const MAX_PENDING_IDS = 256;
const RECORD_LIMITS_PER_MINUTE = { lifecycle: 300, relaylatency: 100 } as const;
type DiagnosticBucket = keyof typeof RECORD_LIMITS_PER_MINUTE;
const JID_ATTRIBUTES = new Set(['from', 'to', 'jid', 'call-creator', 'participant']);
const JID_DOMAINS = new Set(['s.whatsapp.net', 'lid', 'c.us', 'g.us', 'broadcast']);

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function pseudonymizeJid(value: string): string {
  const match = /^([^@]+?)(:\d+)?@([^@]+)$/.exec(value);
  if (!match || !JID_DOMAINS.has(match[3])) return `jid-${fingerprint(value)}`;
  return `peer-${fingerprint(`${match[1]}@${match[3]}`)}${match[2] || ''}@${match[3]}`;
}

function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') return value.slice(0, MAX_VALUE_LENGTH);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function attributes(source: any, allowed: readonly string[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (!source || typeof source !== 'object') return result;
  for (const name of allowed) {
    const raw = source[name];
    const value = JID_ATTRIBUTES.has(name) && typeof raw === 'string' ? pseudonymizeJid(raw) : scalar(raw);
    if (value !== undefined) result[name] = value;
  }
  return result;
}

function summarizeNode(node: any, depth = 0, budget = { remaining: MAX_NODES }): any {
  if (!node || typeof node !== 'object' || typeof node.tag !== 'string' || budget.remaining-- <= 0) {
    return undefined;
  }
  const summary: any = {
    tag: scalar(node.tag),
    attrs: attributes(node.attrs, node.tag === 'error' ? ERROR_ATTRIBUTES : ATTRIBUTES),
  };
  for (const [name, allowed] of Object.entries(MEDIA_ATTRIBUTES[node.tag] || {})) {
    const raw = node.attrs?.[name];
    if ((typeof raw === 'string' || typeof raw === 'number') && allowed.includes(String(raw))) {
      summary.attrs[name] = String(raw);
    }
  }
  // Never serialize raw payloads, frame bytes, ciphertext or a caller-owned object.
  if (ArrayBuffer.isView(node.content) || node.content instanceof ArrayBuffer) {
    summary.byteLength = node.content.byteLength;
  } else if (depth < 3 && Array.isArray(node.content)) {
    const children = [];
    for (let i = 0; i < Math.min(node.content.length, MAX_CHILDREN) && budget.remaining > 0; i++) {
      const child = summarizeNode(node.content[i], depth + 1, budget);
      if (child) children.push(child);
    }
    if (children.length) summary.children = children;
  }
  return summary;
}

function findCallId(node: any): string | undefined {
  const value = node?.attrs?.['call-id'];
  if (typeof value === 'string' && value) return value;
  for (const child of node?.children || []) {
    const found = findCallId(child);
    if (found) return found;
  }
  return undefined;
}

function containsCallTag(node: any): boolean {
  return CALL_TAGS.has(node?.tag) || (node?.children || []).some(containsCallTag);
}

function containsPrioritySignal(node: any): boolean {
  return (
    node.tag === 'error' ||
    node.attrs.error !== undefined ||
    node.attrs.type === 'error' ||
    (CALL_TAGS.has(node.tag) && node.tag !== 'relaylatency') ||
    (CALL_TAGS.has(node.attrs.type) && node.attrs.type !== 'relaylatency') ||
    (node.children || []).some(containsPrioritySignal)
  );
}

function containsRelayLatency(node: any): boolean {
  return (
    node.tag === 'relaylatency' ||
    node.attrs.type === 'relaylatency' ||
    (node.children || []).some(containsRelayLatency)
  );
}

/** Optional bounded diagnostics. Observes events only; never changes call signaling or state. */
export function bindZapoCallDiagnostics(
  client: any,
  instanceName: string,
  write: (record: string) => void,
  enabled: boolean,
): void {
  if (!enabled || !client || (typeof client !== 'object' && typeof client !== 'function')) return;
  try {
    if (typeof client.on !== 'function' || boundClients.has(client)) return;
    boundClients.add(client);
    const pendingIds = new Map<string, string>();
    const pendingRelayIds = new Map<string, string>();
    let windowStart = Date.now();
    let counts = { lifecycle: 0, relaylatency: 0 };
    const suppressionWritten = new Set<DiagnosticBucket>();

    const emit = (kind: string, fields: Record<string, unknown>, bucket: DiagnosticBucket = 'lifecycle') => {
      const now = Date.now();
      if (now - windowStart >= 60_000 || now < windowStart) {
        windowStart = now;
        counts = { lifecycle: 0, relaylatency: 0 };
        suppressionWritten.clear();
      }
      const common = { timestamp: new Date(now).toISOString(), instance: `instance-${fingerprint(instanceName)}` };
      const limitPerMinute = RECORD_LIMITS_PER_MINUTE[bucket];
      if (counts[bucket] >= limitPerMinute) {
        if (!suppressionWritten.has(bucket)) {
          suppressionWritten.add(bucket);
          write(`[ZapoCallTrace] ${JSON.stringify({ ...common, kind: 'suppressed', bucket, limitPerMinute })}`);
        }
        return;
      }
      counts[bucket]++;
      write(`[ZapoCallTrace] ${JSON.stringify({ ...common, kind, ...fields })}`);
    };

    const transport = (kind: 'transport_in' | 'transport_out') => (event: any) => {
      try {
        const raw = event?.node;
        if (!raw || !['call', 'ack', 'receipt'].includes(raw.tag)) return;
        if (raw.tag === 'ack' && raw.attrs?.class !== 'call') return;
        const node = summarizeNode(raw);
        if (!node) return;
        const id = typeof node.attrs.id === 'string' ? node.attrs.id : undefined;
        const priorityCallId = id ? pendingIds.get(id) : undefined;
        const relayCallId = id ? pendingRelayIds.get(id) : undefined;
        const correlatedCallId = priorityCallId || relayCallId;
        if (node.tag === 'receipt' && !containsCallTag(node) && !correlatedCallId) return;
        const callId = findCallId(node) || correlatedCallId;
        const bucket: DiagnosticBucket =
          !priorityCallId &&
          !containsPrioritySignal(node) &&
          (relayCallId || containsRelayLatency(node) || node.tag === 'ack')
            ? 'relaylatency'
            : 'lifecycle';
        // Track both directions so ACKs without a type can inherit the signal's bucket.
        // Unmatched routine ACKs stay in the noise bucket even after their ID was evicted.
        // Noise has its own bounded cache and cannot evict delayed accept ACK correlation.
        if (node.tag === 'call' && id && callId) {
          const pending = bucket === 'relaylatency' ? pendingRelayIds : pendingIds;
          pending.delete(id);
          pending.set(id, callId);
          if (pending.size > MAX_PENDING_IDS) pending.delete(pending.keys().next().value);
        }
        emit(kind, { callId, node }, bucket);
      } catch {
        // Logging, accessors and malformed debug payloads must not affect the protocol.
      }
    };

    const state = (kind: string) => (call: any) => {
      try {
        if (!call || typeof call !== 'object') return;
        const callId = scalar(call.callId);
        if (typeof callId !== 'string' || !callId) return;
        emit(kind, {
          callId,
          direction: scalar(call.direction),
          state: scalar(call.stateData?.state ?? call.state),
          endReason: scalar(call.stateData?.endReason ?? call.endReason),
          canAccept: typeof call.canAccept === 'boolean' ? call.canAccept : undefined,
        });
      } catch {
        // Diagnostics are best effort even when a provider getter or writer throws.
      }
    };

    client.on('debug_transport_node_in', transport('transport_in'));
    client.on('debug_transport_node_out', transport('transport_out'));
    client.on('voip_call_state', state('state'));
    client.on('voip_call_incoming', state('incoming'));
    client.on('voip_call_ended', state('ended'));
    try {
      emit('enabled', {});
    } catch {
      // A failed startup record must not detach diagnostics or affect the client.
    }
  } catch {
    // A client without compatible debug subscriptions remains usable.
  }
}
