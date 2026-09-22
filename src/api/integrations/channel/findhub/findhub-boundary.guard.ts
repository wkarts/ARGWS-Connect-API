import { prismaRepository, waMonitor } from '@api/server.module';
import { BadRequestException } from '@exceptions';
import { NextFunction, Request, Response } from 'express';

const allowed = new Set(['instance', 'findhub', 'webhook', 'websocket', 'rabbitmq', 'nats', 'sqs', 'kafka', 'pusher']);

export async function findHubChannelBoundary(req: Request, _res: Response, next: NextFunction) {
  const name = req.params.instanceName;
  if (!name) return next();
  const runtime = waMonitor.waInstances[name];
  const provider =
    runtime?.integration ??
    (
      await prismaRepository.instance.findUnique({
        where: { name },
        select: { integration: true },
      })
    )?.integration;
  if (provider !== 'GOOGLE-FIND-HUB') return next();
  const root = req.originalUrl.split('?')[0].split('/').filter(Boolean)[0];
  if (!allowed.has(root))
    throw new BadRequestException('Este recurso não pertence ao canal Google Find Hub. Use /findhub.');
  return next();
}
