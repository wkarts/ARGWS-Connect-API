import { createHash, randomUUID } from 'crypto';

import { DiagnosticCategory, DiagnosticCode, DiagnosticEvent, DiagnosticLevel } from './diagnostic-types';

const CATALOG: Record<DiagnosticCode, [DiagnosticCategory, string]> = {
  'http.request': ['http', 'Requisição HTTP concluída.'],
  'webhook.delivery': ['http', 'Tentativa de entrega de webhook registrada.'],
  'runtime.started': ['runtime', 'Serviço de diagnóstico iniciado.'],
  'runtime.sample': ['runtime', 'Amostra de recursos do processo.'],
  'runtime.error': ['error', 'Erro técnico registrado.'],
  'findhub.reconciliation': ['runtime', 'Reconciliação técnica do Google Find Hub registrada.'],
  'connection.state': ['connection', 'Estado da conexão atualizado.'],
  'call.signaling': ['call', 'Sinalização de chamada observada.'],
  'call.state': ['call', 'Estado da chamada atualizado.'],
  'call.action': ['call', 'Comando de chamada registrado.'],
  'call.media': ['call', 'Estado do canal de mídia atualizado.'],
  'frontend.error': ['frontend', 'Erro técnico no Manager.'],
  'diagnostics.exported': ['system', 'Pacote de diagnóstico exportado.'],
  'diagnostics.settings': ['system', 'Configuração do diagnóstico atualizada.'],
};
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AxiosError',
  'AbortError',
  'TimeoutError',
  'ValidationError',
  'NotFoundException',
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'InternalServerErrorException',
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
  'PrismaClientRustPanicError',
]);
const ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EMFILE',
  'ENFILE',
  'EROFS',
  'EIO',
  'EBUSY',
  'ERR_NETWORK',
  'ERR_BAD_REQUEST',
  'ERR_BAD_RESPONSE',
  'ERR_CANCELED',
  'ERR_INVALID_URL',
  'ERR_HTTP_HEADERS_SENT',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_OUT_OF_RANGE',
  'ERR_INVALID_ARG_TYPE',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const COMPONENTS = new Set([
  'api',
  'http',
  'express',
  'main',
  'runtime',
  'logger',
  'process',
  'manager',
  'frontend',
  'diagnostics',
  'findhub',
  'zapo',
  'baileys',
  'voip',
  'webhook',
  'websocket',
  'database',
  'redis',
  'storage',
  'operations',
  'uncaughtException',
  'unhandledRejection',
  'native-webhook',
  'meta-webhook',
  'voice-media',
  'video-media',
]);
// Only source basenames known to this application are readable. Unknown names become a fingerprint;
// full paths, function names, URLs and the first stack line are never included.
const SOURCE_FILES = new Set([
  'main',
  'index',
  'server',
  'app',
  'logger',
  'diagnostic-service',
  'diagnostic-store',
  'diagnostic-sanitizer',
  'whatsapp.zapo.service',
  'zapo.whatsapp.service',
  'whatsapp.baileys.service',
  'zapo.call-diagnostics',
  'WaCallMediaSession',
  'WaCallManager',
  'WaCallInfo',
  'signaling',
  'bridge',
]);
const ROUTE_PARTS = new Set([
  'api',
  'v1',
  'v2',
  'manager',
  'health',
  'metrics',
  'verify-creds',
  'instance',
  'instances',
  'call',
  'calls',
  'offer',
  'accept',
  'reject',
  'end',
  'mute',
  'startCall',
  'acceptCall',
  'rejectCall',
  'endCall',
  'muteCall',
  'mediaTicket',
  'videoMediaTicket',
  'capabilities',
  'list',
  'create',
  'connect',
  'disconnect',
  'connectionState',
  'fetchInstances',
  'restart',
  'logout',
  'delete',
  'setPresence',
  'migrateProvider',
  'diagnostics',
  'events',
  'status',
  'settings',
  'export',
  'download',
  'client-events',
  'snapshot',
  'statistics',
  'history',
  'archives',
  'operations',
  'message',
  'chat',
  'group',
  'webhook',
  'webhooks',
  'sendText',
  'sendMedia',
  'sendTemplate',
  'sendWhatsAppAudio',
  'findMessages',
  'findContacts',
  'findChats',
  'find',
  'set',
  'update',
  'template',
  'templates',
  'localTemplate',
  'business',
  'catalog',
  'profile',
  'auth',
  'login',
  'session',
  'refresh',
  'me',
  'setup',
  'mfa',
  'realtime',
  'media',
  'ws',
  'socket.io',
  'integrations',
  'channels',
  'contacts',
  'flows',
  'extensions',
  'queues',
  'dashboard',
  'errors',
  'unknown',
]);
const ROUTE_PARAMS = new Set(['instanceName', 'instance', 'id', 'callId', 'phone_number', 'accountId', 'ticket']);
const CALL_TAGS = new Set([
  'call',
  'ack',
  'receipt',
  'offer',
  'accept',
  'preaccept',
  'terminate',
  'reject',
  'transport',
  'relaylatency',
  'relay_election',
  'mute_v2',
  'enc',
  'encopt',
  'device-identity',
  'privacy',
  'audio',
  'video',
  'net',
  'capability',
  'relay',
  'te',
  'token',
  'key',
  'rte',
  'retry',
  'error',
  'destination',
  'to',
  'user',
  'device',
  'relay_data',
]);
// Keep the same bounded protocol metadata accepted by the transport observer.
const MEDIA_ATTRIBUTES: Record<string, Record<string, readonly string[]>> = {
  audio: { enc: ['opus', 'speex', 'amr', 'amr-wb'], rate: ['8000', '12000', '16000', '24000', '32000', '48000'] },
  net: { medium: ['0', '1', '2', '3'] },
  encopt: { keygen: ['1', '2'] },
};
const SIGNAL_TYPES = new Set([
  'call',
  'offer',
  'accept',
  'preaccept',
  'terminate',
  'reject',
  'transport',
  'relaylatency',
  'relay_election',
  'mute_v2',
  'retry',
  'error',
  'msg',
  'pkmsg',
  'result',
  'get',
  'set',
  'read',
  'delivery',
  '0',
  '1',
  '2',
]);
const END_REASONS = new Set([
  'user_ended',
  'user-ended',
  'userEnded',
  'UserEnded',
  'remote_ended',
  'remote-ended',
  'RemoteEnded',
  'rejected',
  'Rejected',
  'declined',
  'timeout',
  'Timeout',
  'busy',
  'Busy',
  'failed',
  'Failed',
  'error',
  'accepted_elsewhere',
  'AcceptedElsewhere',
  'rejected_elsewhere',
  'RejectedElsewhere',
  'missed',
  'normal',
  'hangup',
  'cancel',
  'cancelled',
  'canceled',
  'unavailable',
  'expired',
  'no_answer',
  'no-answer',
  'network_error',
  'connection_failed',
  'crypto_error',
  'forbidden',
  'not-authorized',
  'bad-request',
  'not-allowed',
  'not-found',
  'service-unavailable',
  'unsupported',
  'invalid',
  'media_failed',
  'do_not_disturb',
  'unknown',
]);
const STATES = new Set([
  'idle',
  'initiating',
  'incoming_ringing',
  'on_hold',
  'offering',
  'outgoing',
  'incoming',
  'ringing',
  'calling',
  'connecting',
  'connected',
  'active',
  'accepted',
  'ended',
  'terminated',
  'rejected',
  'failed',
  'disconnected',
  'closed',
  'open',
  'close',
  'opening',
  'reconnecting',
  'logged_out',
  'loggedOut',
  'qr',
  'pairing',
  'online',
  'offline',
]);
const DIRECTIONS = new Set(['incoming', 'outgoing', 'inbound', 'outbound']);
const WEBHOOK_EVENTS = new Set([
  'APPLICATION_STARTUP',
  'INSTANCE_CREATE',
  'INSTANCE_DELETE',
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'STATUS_INSTANCE',
  'MESSAGES_SET',
  'MESSAGES_UPSERT',
  'MESSAGES_EDITED',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
  'SEND_MESSAGE_UPDATE',
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'PRESENCE_UPDATE',
  'CHATS_SET',
  'CHATS_UPDATE',
  'CHATS_UPSERT',
  'CHATS_DELETE',
  'GROUPS_UPSERT',
  'GROUPS_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
  'CALL',
  'TYPEBOT_START',
  'TYPEBOT_CHANGE_STATUS',
  'LABELS_EDIT',
  'LABELS_ASSOCIATION',
  'CREDS_UPDATE',
  'MESSAGING_HISTORY_SET',
  'REMOVE_INSTANCE',
  'LOGOUT_INSTANCE',
]);
const KINDS = new Set([
  'transport_in',
  'transport_out',
  'state',
  'incoming',
  'ended',
  'enabled',
  'suppressed',
  'command',
  'offer',
  'accept',
  'reject',
  'end',
  'mute',
  'result',
  'error',
]);

export function pseudonym(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function read(source: unknown, key: string): unknown {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return undefined;
  try {
    // Reading is deliberately isolated: provider objects can contain throwing accessors/proxies.
    return source[key];
  } catch {
    return undefined;
  }
}

function token(value: unknown, allow: Set<string>): string | undefined {
  return typeof value === 'string' && allow.has(value) ? value : undefined;
}

function numeric(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && ID.test(value) ? value : undefined;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function instance(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (/^[a-f0-9]{12}$/.test(value)) return `instance-${value}`;
  return /^instance-[a-f0-9]{12}$/.test(value) ? value : `instance-${pseudonym(value)}`;
}

function component(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return COMPONENTS.has(value) ? value : `component-${pseudonym(value)}`;
}

function route(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512 || /[?#\\]|:\/\//.test(value)) return undefined;
  if (ROUTE_PARTS.has(value)) return value;
  if (!value.startsWith('/')) return undefined;
  const parts = value.split('/');
  if (parts.length > 12) return undefined;
  return parts
    .map((part) => {
      if (!part || ROUTE_PARTS.has(part)) return part;
      if (part.startsWith(':') && ROUTE_PARAMS.has(part.slice(1))) return part;
      return ':value';
    })
    .join('/');
}

function errorCode(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9999) return value;
  if (typeof value !== 'string') return undefined;
  if (ERROR_CODES.has(value) || /^P\d{4}$/.test(value)) return value;
  if (/^\d{1,4}$/.test(value)) return Number(value);
  return undefined;
}

/** Safe error metadata only. Error messages, causes, request/response objects and SQL are excluded. */
export function diagnosticError(error: unknown): Record<string, unknown> {
  const name = token(read(error, 'name'), ERROR_NAMES) || 'Error';
  const code = errorCode(read(error, 'code'));
  const rawStatus = read(error, 'status') ?? read(error, 'statusCode') ?? read(read(error, 'response'), 'status');
  const status =
    typeof rawStatus === 'number' && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
      ? rawStatus
      : undefined;
  const stack = read(error, 'stack');
  const frames: Array<Record<string, unknown>> = [];
  if (typeof stack === 'string') {
    for (const line of stack.slice(0, 16_384).split('\n').slice(1, 25)) {
      // The anchored frame suffix avoids accidentally retaining prose from a message/stack header.
      const location = /^\s+at\s+.+?(?:\(|\s)([^\s():]+\.[cm]?[jt]s):(\d{1,7}):(\d{1,7})\)?\s*$/.exec(line);
      if (!location) continue;
      const basename = location[1].replace(/\\/g, '/').split('/').pop();
      const extension = /\.[cm]?[jt]s$/.exec(basename)?.[0] || '.js';
      const source = basename.slice(0, -extension.length);
      frames.push({
        file: SOURCE_FILES.has(source) ? `${source}${extension}` : `source-${pseudonym(basename)}${extension}`,
        line: Number(location[2]),
        column: Number(location[3]),
      });
      if (frames.length === 8) break;
    }
  }
  const details = compact({ name, code, status, frames: frames.length ? frames : undefined });
  return { ...details, fingerprint: pseudonym(JSON.stringify(details)) };
}

function jid(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 256) return undefined;
  if (
    /^(?:jid-[a-f0-9]{12}|peer-[a-f0-9]{12}(?::\d{1,5})?@(?:s\.whatsapp\.net|lid|c\.us|g\.us|broadcast))$/.test(value)
  ) {
    return value;
  }
  const match = /^([^@]+?)(:\d{1,5})?@(s\.whatsapp\.net|lid|c\.us|g\.us|broadcast)$/.exec(value);
  if (!match) return `jid-${pseudonym(value)}`;
  return `peer-${pseudonym(`${match[1]}@${match[3]}`)}${match[2] || ''}@${match[3]}`;
}

function signalNode(value: unknown, depth = 0, budget = { left: 48 }): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || budget.left-- <= 0 || depth > 3) return undefined;
  const tag = token(read(value, 'tag'), CALL_TAGS);
  if (!tag) return undefined;
  const attrs = read(value, 'attrs');
  const safeAttrs: Record<string, unknown> = {};
  for (const key of ['from', 'to', 'jid', 'call-creator', 'participant']) {
    const safe = jid(read(attrs, key));
    if (safe !== undefined) safeAttrs[key] = safe;
  }
  for (const key of ['id', 'call-id']) {
    const safe = identifier(read(attrs, key));
    if (safe !== undefined) safeAttrs[key] = safe;
  }
  for (const key of ['class', 'type']) {
    const safe = token(read(attrs, key), SIGNAL_TYPES);
    if (safe !== undefined) safeAttrs[key] = safe;
  }
  const reason = token(read(attrs, 'reason'), END_REASONS);
  if (reason) safeAttrs.reason = reason;
  for (const key of ['error', 'code']) {
    const safe = errorCode(read(attrs, key));
    if (safe !== undefined) safeAttrs[key] = safe;
  }
  for (const [key, allowed] of Object.entries(MEDIA_ATTRIBUTES[tag] || {})) {
    const raw = read(attrs, key);
    if ((typeof raw === 'string' || typeof raw === 'number') && allowed.includes(String(raw))) {
      safeAttrs[key] = String(raw);
    }
  }
  const result: Record<string, unknown> = { tag, attrs: safeAttrs };
  if (read(attrs, 'error') !== undefined) result.hasError = true;
  const byteLength = numeric(read(value, 'byteLength'), 32 * 1024 * 1024);
  if (byteLength !== undefined) result.byteLength = byteLength;
  const children = read(value, 'children');
  if (Array.isArray(children) && depth < 3) {
    const safeChildren = children
      .slice(0, 12)
      .map((child) => signalNode(child, depth + 1, budget))
      .filter(Boolean);
    if (safeChildren.length) result.children = safeChildren;
  }
  return result;
}

function callDetails(source: unknown): Record<string, unknown> {
  const canAccept = read(source, 'canAccept');
  const muted = read(source, 'muted');
  return compact({
    kind: token(read(source, 'kind'), KINDS),
    direction: token(read(source, 'direction'), DIRECTIONS),
    state: token(read(source, 'state'), STATES),
    endReason: token(read(source, 'endReason'), END_REASONS),
    canAccept: typeof canAccept === 'boolean' ? canAccept : undefined,
    muted: typeof muted === 'boolean' ? muted : undefined,
    durationMs: numeric(read(source, 'durationMs'), 86_400_000),
    limitPerMinute: numeric(read(source, 'limitPerMinute'), 100_000),
    node: signalNode(read(source, 'node')),
    error: read(source, 'error') ? diagnosticError(read(source, 'error')) : undefined,
  });
}

function signalHasError(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (
    read(node, 'tag') === 'error' ||
    read(node, 'hasError') === true ||
    read(read(node, 'attrs'), 'error') !== undefined
  )
    return true;
  const children = read(node, 'children');
  return Array.isArray(children) && children.some(signalHasError);
}

/** Rebuilds every persisted event from a fixed field allowlist; never serializes caller-owned objects. */
export function sanitizeDiagnostic(input: unknown, now = Date.now()): DiagnosticEvent | null {
  try {
    const rawCode = read(input, 'code');
    if (typeof rawCode !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOG, rawCode)) return null;
    const code = rawCode as DiagnosticCode;
    const [category, summary] = CATALOG[code];
    const record = read(input, 'record') || input;
    let level: DiagnosticLevel = 'info';
    let details: Record<string, unknown>;
    switch (code) {
      case 'http.request': {
        const status = numeric(read(input, 'status'), 599);
        const aborted = read(input, 'aborted') === true;
        level = status >= 500 ? 'error' : status >= 400 || aborted ? 'warn' : 'info';
        details = compact({
          method: token(read(input, 'method'), new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])),
          status,
          durationMs: numeric(read(input, 'durationMs'), 86_400_000),
          route: route(read(input, 'route')),
          aborted,
        });
        break;
      }
      case 'runtime.error':
        level = read(input, 'level') === 'warn' ? 'warn' : 'error';
        details = diagnosticError(read(input, 'error'));
        if (read(input, 'component') === 'findhub-auth' && read(read(input, 'error'), 'name') === 'FindHubAuthError') {
          const failure = read(input, 'error');
          const context = read(failure, 'diagnosticContext');
          const failureCode = read(failure, 'code');
          const fields = read(context, 'fields');
          details.findHub = compact({
            code:
              Number.isInteger(failureCode) && Number(failureCode) >= 9101 && Number(failureCode) <= 9116
                ? failureCode
                : undefined,
            phase: token(read(context, 'phase'), new Set(['exchange', 'adm', 'spot'])),
            http: numeric(read(context, 'http'), 599),
            fields: typeof fields === 'string' && /^[01]{4}$/.test(fields) ? fields : undefined,
            integrity: token(read(context, 'integrity'), new Set(['missing'])),
          });
        }
        break;
      case 'findhub.reconciliation': {
        const status = token(
          read(input, 'status'),
          new Set([
            'provider_data',
            'no_usable_position',
            'recovered',
            'imported_outside_target',
            'duplicates_only',
            'provider_reports_unusable',
            'no_provider_reports',
            'retention_filtered',
            'no_recoverable_positions',
          ]),
        );
        details = compact({
          reconciliationId: identifier(read(input, 'reconciliationId')),
          phase: token(read(input, 'phase'), new Set(['attempt', 'completed'])),
          trigger: token(read(input, 'trigger'), new Set(['manual', 'boot', 'periodic'])),
          status,
          rangeSeconds: numeric(read(input, 'rangeSeconds'), 365 * 86400),
          attemptsRequested: numeric(read(input, 'attemptsRequested'), 10),
          attemptsCompleted: numeric(read(input, 'attemptsCompleted'), 10),
          attempt: numeric(read(input, 'attempt'), 10),
          durationMs: numeric(read(input, 'durationMs'), 2147483647),
          fcmPayloadsReceived: numeric(read(input, 'fcmPayloadsReceived'), 100000),
          deviceMismatchPayloads: numeric(read(input, 'deviceMismatchPayloads'), 100000),
          metadataDecodeFailures: numeric(read(input, 'metadataDecodeFailures'), 100000),
          providerReportsDecoded: numeric(read(input, 'providerReportsDecoded'), 1000000),
          reportsWithEncryptedLocation: numeric(read(input, 'reportsWithEncryptedLocation'), 1000000),
          reportsWithoutEncryptedLocation: numeric(read(input, 'reportsWithoutEncryptedLocation'), 1000000),
          decryptedReports: numeric(read(input, 'decryptedReports'), 1000000),
          decryptRejectedReports: numeric(read(input, 'decryptRejectedReports'), 1000000),
          decryptErrors: numeric(read(input, 'decryptErrors'), 1000000),
          invalidReports: numeric(read(input, 'invalidReports'), 1000000),
          validReports: numeric(read(input, 'validReports'), 1000000),
          duplicateValidReports: numeric(read(input, 'duplicateValidReports'), 1000000),
          uniqueValidReports: numeric(read(input, 'uniqueValidReports'), 1000000),
          uniqueReportsReturned: numeric(read(input, 'uniqueReportsReturned'), 1000000),
          duplicateAcrossAttempts: numeric(read(input, 'duplicateAcrossAttempts'), 1000000),
          alreadyStoredReports: numeric(read(input, 'alreadyStoredReports'), 1000000),
          importedReports: numeric(read(input, 'importedReports'), 1000000),
          reportsInTargetRange: numeric(read(input, 'reportsInTargetRange'), 1000000),
          reportsOutsideTargetRange: numeric(read(input, 'reportsOutsideTargetRange'), 1000000),
          reportsSkippedByRetention: numeric(read(input, 'reportsSkippedByRetention'), 1000000),
          recentReports: numeric(read(input, 'recentReports'), 1000000),
          networkReports: numeric(read(input, 'networkReports'), 1000000),
          recoveredPositions: numeric(read(input, 'recoveredPositions'), 1000000),
        });
        level =
          status === 'provider_reports_unusable' || status === 'no_usable_position' ? 'warn' : 'info';
        break;
      }
      case 'webhook.delivery': {
        const event = read(input, 'event');
        const targetId = read(input, 'targetId');
        details = compact({
          event:
            typeof event === 'string' ? token(event.toUpperCase().replace(/[.-]/g, '_'), WEBHOOK_EVENTS) : undefined,
          phase: token(read(input, 'phase'), new Set(['started', 'succeeded', 'failed'])),
          attempt: numeric(read(input, 'attempt'), 1000),
          status: numeric(read(input, 'status'), 599),
          durationMs: numeric(read(input, 'durationMs'), 86_400_000),
          targetId:
            typeof targetId === 'string' && /^(?:[a-f0-9]{12}|[a-f0-9]{64})$/.test(targetId) ? targetId : undefined,
          error: read(input, 'error') ? diagnosticError(read(input, 'error')) : undefined,
        });
        if (details.phase === 'failed' || details.error) level = 'error';
        break;
      }
      case 'runtime.started':
        details = compact({
          version:
            typeof read(input, 'version') === 'string' &&
            /^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/.test(read(input, 'version') as string)
              ? read(input, 'version')
              : undefined,
          nodeVersion:
            typeof read(input, 'nodeVersion') === 'string' &&
            /^v?\d+\.\d+\.\d+$/.test(read(input, 'nodeVersion') as string)
              ? read(input, 'nodeVersion')
              : undefined,
        });
        break;
      case 'runtime.sample':
        details = {};
        for (const field of [
          'uptimeSeconds',
          'rssBytes',
          'heapUsedBytes',
          'heapTotalBytes',
          'externalBytes',
          'cpuUserMicros',
          'cpuSystemMicros',
          'eventLoopDelayMs',
        ]) {
          const value = numeric(read(input, field));
          if (value !== undefined) details[field] = value;
        }
        break;
      case 'connection.state':
        details = compact({
          state: token(read(input, 'state'), STATES),
          reasonCode: numeric(read(input, 'reasonCode'), 99_999),
          provider: token(
            read(input, 'provider'),
            new Set(['ZAPO', 'BAILEYS', 'zapo', 'baileys', 'WHATSAPP-ZAPO', 'WHATSAPP-BAILEYS']),
          ),
          reason: token(read(input, 'reason'), END_REASONS),
          error: read(input, 'error') ? diagnosticError(read(input, 'error')) : undefined,
        });
        if (details.error) level = 'error';
        break;
      case 'call.signaling':
      case 'call.state':
        details = callDetails(record);
        if (code === 'call.signaling') {
          const bucket = token(read(record, 'bucket'), new Set(['lifecycle', 'relaylatency']));
          if (bucket) details.bucket = bucket;
        }
        if (details.error || signalHasError(details.node)) level = 'error';
        else if (details.kind === 'suppressed') level = 'warn';
        break;
      case 'call.media': {
        const closeCode = read(input, 'closeCode');
        details = compact({
          phase: token(read(input, 'phase'), new Set(['connected', 'authenticated', 'closed', 'failed'])),
          reason: token(
            read(input, 'reason'),
            new Set([
              'auth_timeout',
              'auth_failed',
              'invalid_payload',
              'provider_unavailable',
              'call_not_found',
              'socket_error',
              'provider_error',
            ]),
          ),
          closeCode:
            typeof closeCode === 'number' &&
            [
              1000, 1001, 1002, 1003, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015, 4400, 4401,
              4404,
            ].includes(closeCode)
              ? closeCode
              : undefined,
          error: read(input, 'error') ? diagnosticError(read(input, 'error')) : undefined,
        });
        if (details.phase === 'failed' || details.error) level = 'error';
        break;
      }
      case 'call.action':
        details = compact({
          action: token(read(input, 'action'), new Set(['start', 'accept', 'reject', 'end', 'mute'])),
          phase: token(read(input, 'phase'), new Set(['requested', 'completed', 'failed'])),
          muted: typeof read(input, 'muted') === 'boolean' ? read(input, 'muted') : undefined,
          durationMs: numeric(read(input, 'durationMs'), 86_400_000),
          error: read(input, 'error') ? diagnosticError(read(input, 'error')) : undefined,
        });
        if (details.phase === 'failed' || details.error) level = 'error';
        break;
      case 'frontend.error':
        level = 'error';
        details = compact({
          kind: token(read(input, 'kind'), new Set(['window_error', 'unhandled_rejection', 'vue_error'])),
          page: route(read(input, 'page')),
        });
        break;
      case 'diagnostics.exported':
        details = compact({
          format: token(read(input, 'format'), new Set(['jsonl', 'zip', 'json', 'ndjson', 'gzip'])),
          count: numeric(read(input, 'count'), 1_000_000),
          durationMs: numeric(read(input, 'durationMs'), 86_400_000),
        });
        break;
      case 'diagnostics.settings':
        details = compact({
          enabled: typeof read(input, 'enabled') === 'boolean' ? read(input, 'enabled') : undefined,
          retentionDays: numeric(read(input, 'retentionDays'), 365),
          maxStorageMb: numeric(read(input, 'maxStorageMb'), 10_240),
        });
        break;
    }
    return {
      id: randomUUID(),
      timestamp: new Date(now).toISOString(),
      category,
      code,
      summary,
      level,
      ...compact({
        traceId: identifier(read(input, 'traceId')),
        callId: identifier(read(record, 'callId') ?? read(input, 'callId')),
        instanceId: instance(read(record, 'instance') ?? read(input, 'instanceId') ?? read(input, 'instance')),
        component: component(read(input, 'component')),
      }),
      details,
    };
  } catch {
    return null;
  }
}
