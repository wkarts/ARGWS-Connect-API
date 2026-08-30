import dayjs from 'dayjs';
import fs from 'fs';

import { configService, Log } from './env.config';
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

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

/**
 * Generic log values are intentionally reduced to static type descriptors.
 *
 * Do not derive hashes, lengths, object keys, error properties or any other
 * representation from the supplied value here. Credentials and API keys can
 * reach the generic logger through third-party integrations; keeping each
 * returned descriptor independent from the supplied content guarantees that
 * sensitive data does not flow to stdout/stderr, even indirectly.
 */
const describeLogValue = (value: unknown): string => {
  if (value === null) return '[NULL]';
  if (value === undefined) return '[UNDEFINED]';
  if (typeof value === 'string') return '[STRING REDACTED]';
  if (Buffer.isBuffer(value)) return '[BUFFER REDACTED]';
  if (value instanceof Error) return '[ERROR REDACTED]';
  if (Array.isArray(value)) return '[ARRAY REDACTED]';
  if (typeof value === 'object') return '[OBJECT REDACTED]';
  if (typeof value === 'number') return '[NUMBER]';
  if (typeof value === 'boolean') return '[BOOLEAN]';
  if (typeof value === 'bigint') return '[BIGINT]';
  if (typeof value === 'symbol') return '[SYMBOL]';
  if (typeof value === 'function') return '[FUNCTION]';
  return '[UNKNOWN]';
};

export class Logger {
  private readonly configService = configService;
  private context: string;
  private instance: string | null = null;

  constructor(context = 'Logger') {
    this.context = context;
  }

  public setContext(value: string) {
    this.context = value;
  }

  public setInstance(value: string) {
    this.instance = value;
  }

  private console(value: unknown, type: Type) {
    const types: Type[] = [];
    this.configService.get<Log>('LOG').LEVEL.forEach((level) => types.push(Type[level]));
    if (!types.includes(type)) return;

    const descriptor = describeLogValue(value);
    if (configService.get<Log>('LOG').COLOR) {
      console.log(
        Command.BRIGHT + Level[type],
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
        descriptor,
        Command.RESET,
      );
    } else {
      console.log(
        '[ARGWS Connect API]',
        this.instance ? `[${this.instance}]` : '',
        process.pid.toString(),
        '-',
        `${formatDateLog(Date.now())}  `,
        `${type} `,
        `[${this.context}]`,
        descriptor,
      );
    }
  }

  /** Fixed lifecycle/status messages only; never pass credentials here. */
  public system(message: string) {
    console.log('[ARGWS Connect API]', this.instance ? `[${this.instance}]` : '', `[${this.context}]`, message);
  }

  /** Intentional QR terminal surface; pairing codes must never be passed here. */
  public qr(value: string) {
    if (!this.configService.get<Log>('LOG').QRCODE) return;
    process.stdout.write(`\n${value}\n`);
  }

  public log(value: unknown) {
    this.console(value, Type.LOG);
  }
  public info(value: unknown) {
    this.console(value, Type.INFO);
  }
  public warn(value: unknown) {
    this.console(value, Type.WARN);
  }
  public error(value: unknown) {
    this.console(value, Type.ERROR);
  }
  public verbose(value: unknown) {
    this.console(value, Type.VERBOSE);
  }
  public debug(value: unknown) {
    this.console(value, Type.DEBUG);
  }
  public dark(value: unknown) {
    this.console(value, Type.DARK);
  }
}
