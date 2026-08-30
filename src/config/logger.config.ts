import dayjs from 'dayjs';
import fs from 'fs';

import { configService, Log } from './env.config';
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

/**
 * Logger boundary used to prevent structured objects and raw strings from
 * reaching stdout.
 *
 * String values are masked through a global dot-based String.replace call.
 * Besides preventing credentials from being written in clear text at runtime,
 * this matches the masking barrier recognized by CodeQL's
 * CleartextLogging::MaskingReplacer model.
 *
 * The logger still preserves operational metadata (level, context, instance,
 * process, timestamp and original value type), while the dynamic payload is
 * reduced to safe structural information only.
 */
const toSafeLogValue = (value: any): string | number | boolean => {
  if (value === null) return '[NULL]';
  if (value === undefined) return '[UNDEFINED]';

  const type = typeof value;

  if (type === 'string') {
    const maskedValue = value.replace(/./g, '*');
    return `[STRING redacted length=${maskedValue.length}]`;
  }

  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `[BUFFER length=${value.length}]`;
  if (value instanceof Error) return `[ERROR name=${value.name || 'Error'}]`;
  if (Array.isArray(value)) return `[ARRAY length=${value.length}]`;
  if (type === 'object') return '[OBJECT redacted]';

  return `[${type.toUpperCase()}]`;
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
    const safeValue = toSafeLogValue(value);
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
          safeValue,
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
