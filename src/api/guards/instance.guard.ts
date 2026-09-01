import { InstanceDto } from '@api/dto/instance.dto';
import { cache, prismaRepository, waMonitor } from '@api/server.module';
import { CacheConf, configService } from '@config/env.config';
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@exceptions';
import { NextFunction, Request, Response } from 'express';

async function getInstance(instanceName: string) {
  try {
    const cacheConf = configService.get<CacheConf>('CACHE');

    // Runtime memory is the fastest source, but it must never be the only
    // source of truth for lifecycle operations such as DELETE. A disconnected
    // instance may still be persisted even when there is no live runtime.
    if (waMonitor.waInstances[instanceName]) {
      return true;
    }

    // Redis is an optimization/persistence layer, not an authority that can
    // hide a valid database record. If the cache entry was evicted or became
    // stale, continue to the database fallback instead of returning false.
    if (cacheConf.REDIS.ENABLED && cacheConf.REDIS.SAVE_INSTANCES) {
      const keyExists = await cache.has(instanceName);
      if (keyExists) {
        return true;
      }
    }

    const persistedInstance = await prismaRepository.instance.findFirst({
      where: { name: instanceName },
      select: { id: true },
    });

    return !!persistedInstance;
  } catch (error) {
    throw new InternalServerErrorException(error?.toString());
  }
}

export async function instanceExistsGuard(req: Request, _: Response, next: NextFunction) {
  if (req.originalUrl.includes('/instance/create') || req.originalUrl.includes('/instance/fetchInstances')) {
    return next();
  }

  const param = req.params as unknown as InstanceDto;
  if (!param?.instanceName) {
    throw new BadRequestException('"instanceName" not provided.');
  }

  if (!(await getInstance(param.instanceName))) {
    throw new NotFoundException(`The "${param.instanceName}" instance does not exist`);
  }

  next();
}

export async function instanceLoggedGuard(req: Request, _: Response, next: NextFunction) {
  if (req.originalUrl.includes('/instance/create')) {
    const instance = req.body as InstanceDto;
    if (await getInstance(instance.instanceName)) {
      throw new ForbiddenException(`This name "${instance.instanceName}" is already in use.`);
    }

    if (waMonitor.waInstances[instance.instanceName]) {
      delete waMonitor.waInstances[instance.instanceName];
    }
  }

  next();
}
