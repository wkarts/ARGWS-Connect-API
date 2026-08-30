import dayjs from 'dayjs';
import fs from 'fs';

import { configService, Log } from './env.config';
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

const SENSITIVE_LOG_KEYS = [
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'password',
  'privatekey',
  'secret',
  'setcookie',
  'token',
];

const isSensitiveLogKey = (key: string) => {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_LOG_KEYS.some((sensitiveKey) => normalized.includes(sensitiveKey));
};

const redactSensitiveText = (value: string) =>
  value
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:api[-_ ]?key|apikey|authorization|password|secret|token)\s*[:=]\s*)([^\s,;}\]]+)/gi, '$1[REDACTED]');

const sanitizeLogValue = (value: any, seen = new WeakSet<object>(), depth = 0): any => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value !== 'object') return value;
  if (depth >= 8) return '[MAX_DEPTH]';
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack) : undefined,
    };
  }
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);

  if (Array.isArray(value)) {
    const sanitizedArray = value.map((item) => sanitizeLogValue(item, seen, depth + 1));
    seen.delete(value);
    return sanitizedArray;
  }

  const sanitizedObject: Record<string, any> = {};
  for (const [key, childValue] of Object.entries(value)) {
    sanitizedObject[key] = isSensitiveLogKey(key) ? '[REDACTED]' : sanitizeLogValue(childValue, seen, depth + 1);
  }

  seen.delete(value);
  return sanitizedObject;
};

const formatDateLog = (timestamp: number) =>
  dayjs(timestamp)
    .toDate()
    .toString()
    .replace(/\sGMT.+/, '');

enum Color {
  LOG = '\x1b[32m',
  INFO = '\x1b[34m',
  WARN = '\x1b[33m',
  ERROR = '\x1b[31m',
  DEBUG = '\x1b[36m',
  VERBOSE = '\x1b[37m',
  DARK = '\x1b[30m',
}

enum Command {
  RESET = '\x1b[0m',
  BRIGHT = '\x1b[1m',
  UNDERSCORE = '\x1b[4m',
}

enum Level {
  LOG = Color.LOG + '%s' + Command.RESET,
  DARK = Color.DARK + '%s' + Command.RESET,
  INFO = Color.INFO + '%s' + Command.RESET,
  WARN = Color.WARN + '%s' + Command.RESET,
  ERROR = Color.ERROR + '%s' + Command.RESET,
  DEBUG = Color.DEBUG + '%s' + Command.RESET,
  VERBOSE = Color.VERBOSE + '%s' + Command.RESET,
}

enum Type {
  LOG = 'LOG',
  WARN = 'WARN',
  INFO = 'INFO',
  DARK = 'DARK',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
  VERBOSE = 'VERBOSE',
}

enum Background {
  LOG = '\x1b[42m',
  INFO = '\x1b[44m',
  WARN = '\x1b[43m',
  DARK = '\x1b[40m',
  ERROR = '\x1b[41m',
  DEBUG = '\x1b[46m',
  VERBOSE = '\x1b[47m',
}

export class Logger {
  private readonly configService = configService;
  private context: string;

  constructor(context = 'Logger') {
    this.context = context;
  }

  private instance = null;

  public setContext(value: string) {
    this.context = value;
  }

  public setInstance(value: string) {
    this.instance = value;
  }

  private console(value: any, type: Type) {
    const types: Type[] = [];

    this.configService.get<Log>('LOG').LEVEL.forEach((level) => types.push(Type[level]));

    const typeValue = typeof value;
    const safeValue = sanitizeLogValue(value);
    if (types.includes(type)) {
      if (configService.get<Log>('LOG').COLOR) {
        console.log(
          /*Command.UNDERSCORE +*/ Command.BRIGHT + Level[type],
          '[ARGWS Connect API]',
          Command.BRIGHT + Color[type],
          this.instance ? `[${this.instance}]` : '',
          Command.BRIGHT + Color[type],
          `v${packageJson.version}`,
          Command.BRIGHT + Color[type],
          process.pid.toString(),
          Command.RESET,
          Command.BRIGHT + Color[type],
          '-',
          Command.BRIGHT + Color.VERBOSE,
          `${formatDateLog(Date.now())}  `,
          Command.RESET,
          Color[type] + Background[type] + Command.BRIGHT,
          `${type} ` + Command.RESET,
          Color.WARN + Command.BRIGHT,
          `[${this.context}]` + Command.RESET,
          Color[type] + Command.BRIGHT,
          `[${typeValue}]` + Command.RESET,
          Color[type],
          typeValue !== 'object' ? safeValue : '',
          Command.RESET,
        );
        typeValue === 'object' ? console.log(/*Level.DARK,*/ safeValue, '\n') : '';
      } else {
        console.log(
          '[ARGWS Connect API]',
          this.instance ? `[${this.instance}]` : '',
          process.pid.toString(),
          '-',
          `${formatDateLog(Date.now())}  `,
          `${type} `,
          `[${this.context}]`,
          `[${typeValue}]`,
          safeValue,
        );
      }
    }
  }

  public log(value: any) {
    this.console(value, Type.LOG);
  }

  public info(value: any) {
    this.console(value, Type.INFO);
  }

  public warn(value: any) {
    this.console(value, Type.WARN);
  }

  public error(value: any) {
    this.console(value, Type.ERROR);
  }

  public verbose(value: any) {
    this.console(value, Type.VERBOSE);
  }

  public debug(value: any) {
    this.console(value, Type.DEBUG);
  }

  public dark(value: any) {
    this.console(value, Type.DARK);
  }
}
