import { createHash } from 'crypto';
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

const hashValue = (value: string | Buffer) => createHash('sha256').update(value).digest('hex').slice(0, 12);

const describeLogValue = (value: unknown): string | number | boolean => {
  if (value === null) return '[NULL]';
  if (value === undefined) return '[UNDEFINED]';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `[BIGINT digits=${value.toString().length}]`;
  if (typeof value === 'string') return `[STRING length=${value.length} sha256=${hashValue(value)}]`;
  if (Buffer.isBuffer(value)) return `[BUFFER length=${value.length} sha256=${hashValue(value)}]`;
  if (value instanceof Error) {
    const errorCode = typeof (value as any).code === 'string' ? (value as any).code : 'unknown';
    return `[ERROR name=${value.name || 'Error'} code=${errorCode}]`;
  }
  if (Array.isArray(value)) return `[ARRAY length=${value.length}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
      .slice(0, 12)
      .sort()
      .join(',');
    return `[OBJECT keys=${keys || 'none'}]`;
  }
  return `[${typeof value}]`;
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
