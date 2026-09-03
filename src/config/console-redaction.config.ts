const SESSION_PREFIXES = ['Closing session:', 'Removing old closed session:'];
const SENSITIVE_KEY = /(privkey|rootkey|identitykey|remotekey|prekey|basekey|secret|password|authorization|cookie|token|credential|apikey|api_key|mediakey|chainkey)/i;
const MAX_DEPTH = 5;

function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return '[BINARY REDACTED]';
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[OBJECT REDACTED]';
  if (seen.has(value as object)) return '[CIRCULAR REDACTED]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeValue(entry, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(entry, depth + 1, seen);
  }
  return output;
}

function sanitizeConsoleArgs(args: unknown[]): unknown[] {
  const first = args[0];
  if (typeof first === 'string' && SESSION_PREFIXES.some((prefix) => first.startsWith(prefix))) {
    return [`${SESSION_PREFIXES.find((prefix) => first.startsWith(prefix))} [SESSION STATE REDACTED]`];
  }
  return args.map((value) => sanitizeValue(value));
}

let installed = false;

/**
 * Protect stdout/stderr from third-party libraries that bypass the canonical
 * Logger and print Signal/session state directly with console.*.
 *
 * The canonical Logger already redacts arbitrary objects. This guard is the
 * final boundary for dependencies such as Baileys/libsignal before Platform
 * observability forwards container logs to a centralized backend.
 */
export function installSensitiveConsoleGuard(): void {
  if (installed) return;
  installed = true;

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = ['log', 'info', 'warn', 'error', 'debug'];
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => original(...sanitizeConsoleArgs(args))) as typeof console[typeof method];
  }
}

export const consoleRedaction = {
  sanitizeConsoleArgs,
};
