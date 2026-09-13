export const DIAGNOSTIC_LEVELS = ['info', 'warn', 'error'] as const;
export const DIAGNOSTIC_CATEGORIES = ['http', 'error', 'connection', 'call', 'runtime', 'frontend', 'system'] as const;
export const DIAGNOSTIC_CODES = [
  'http.request',
  'webhook.delivery',
  'runtime.started',
  'runtime.sample',
  'runtime.error',
  'connection.state',
  'call.signaling',
  'call.state',
  'call.action',
  'call.media',
  'frontend.error',
  'diagnostics.exported',
  'diagnostics.settings',
] as const;

export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];
export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  code: DiagnosticCode;
  summary: string;
  traceId?: string;
  callId?: string;
  instanceId?: string;
  component?: string;
  details: Record<string, unknown>;
}

export interface DiagnosticFilter {
  from?: string;
  to?: string;
  level?: DiagnosticLevel;
  category?: DiagnosticCategory;
  code?: DiagnosticCode;
  traceId?: string;
  callId?: string;
  instanceId?: string;
  cursor?: string;
  limit?: number;
}
