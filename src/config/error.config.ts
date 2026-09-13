import { Logger } from './logger.config';

let installed = false;

export function onUnexpectedError() {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', (error) => {
    const logger = new Logger('uncaughtException');
    logger.error(error);
  });

  process.on('unhandledRejection', (error) => {
    const logger = new Logger('unhandledRejection');
    logger.error(error);
  });
}
