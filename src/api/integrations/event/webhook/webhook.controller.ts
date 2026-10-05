import { createHash, randomUUID } from 'node:crypto';

import { AdditionalWebhookTarget, EventDto } from '@api/integrations/event/event.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { wa } from '@api/types/wa.types';
import { configService, Log, Webhook } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { Prisma } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import * as jwt from 'jsonwebtoken';

import { diagnostics } from '../../../../diagnostics/diagnostics.service';
import { EmitData, EventController, EventControllerInterface } from '../event.controller';

export class WebhookController extends EventController implements EventControllerInterface {
  private readonly logger = new Logger('WebhookController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor, true, 'webhook');
  }

  override async set(instanceName: string, data: EventDto): Promise<wa.LocalWebHook> {
    const config = data.webhook;
    if (!config) throw new BadRequestException('Webhook configuration is required.');
    const validateUrl = (url: string) => {
      try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
      } catch {
        return false;
      }
    };
    if (config.enabled && !validateUrl(config.url)) {
      throw new BadRequestException('A URL do webhook principal precisa ser HTTP ou HTTPS.');
    }
    if (config.additionalTargets !== undefined && (!Array.isArray(config.additionalTargets) || config.additionalTargets.length > 10)) {
      throw new BadRequestException('Informe no máximo dez destinos adicionais.');
    }
    if (config.additionalTargets?.some((target) => target.enabled && !validateUrl(target.url))) {
      throw new BadRequestException('Cada destino adicional ativo precisa de uma URL HTTP ou HTTPS válida.');
    }

    const instance = this.monitor.waInstances[instanceName];
    const events = config.enabled && !config.events?.length ? EventController.events : config.events ?? [];
    const additionalTargets = config.additionalTargets?.map((target) => ({
      name: target.name?.trim() || '',
      enabled: target.enabled,
      url: target.url.trim(),
      headers: target.headers ?? {},
      byEvents: target.byEvents ?? false,
      events: target.events?.length ? target.events : EventController.events,
    }));

    const result = await this.prisma.webhook.upsert({
      where: {
        instanceId: instance.instanceId,
      },
      update: {
        enabled: config.enabled,
        events,
        url: config.url.trim(),
        headers: config.headers,
        webhookBase64: config.base64,
        webhookByEvents: config.byEvents,
        // Legacy clients omit this field; their updates must not remove existing destinations.
        ...(additionalTargets !== undefined ? { additionalTargets: additionalTargets as Prisma.InputJsonValue } : {}),
      },
      create: {
        enabled: config.enabled,
        events,
        instanceId: instance.instanceId,
        url: config.url.trim(),
        headers: config.headers,
        webhookBase64: config.base64,
        webhookByEvents: config.byEvents,
        additionalTargets: (additionalTargets ?? []) as Prisma.InputJsonValue,
      },
    });
    this.cacheConfig(instanceName, result);
    // Media enrichment uses a copy loaded at connection startup. Refresh it without restarting WhatsApp.
    if (instance.localWebhook) {
      instance.localWebhook.enabled = Boolean(
        result.enabled ||
          (Array.isArray(result.additionalTargets) && result.additionalTargets.some((target: any) => target.enabled)),
      );
      instance.localWebhook.webhookBase64 = Boolean(result.webhookBase64);
    }
    return result;
  }

  public async emit({
    instanceName,
    origin,
    event,
    data,
    serverUrl,
    dateTime,
    sender,
    apiKey,
    local,
    integration,
    extra,
  }: EmitData): Promise<void> {
    if (integration && !integration.includes('webhook')) {
      return;
    }

    const instance = (await this.get(instanceName)) as wa.LocalWebHook;

    const webhookConfig = configService.get<Webhook>('WEBHOOK');
    const we = event.replace(/[.-]/gm, '_').toUpperCase();
    const transformedWe = we.replace(/_/gm, '-').toLowerCase();
    const enabledLog = configService.get<Log>('LOG').LEVEL.includes('WEBHOOKS');
    const payload = {
      ...(extra ?? {}),
      event,
      instance: instanceName,
      data,
      date_time: dateTime,
      sender,
      server_url: serverUrl,
      apikey: apiKey,
    };

    const deliveries: Promise<void>[] = [];
    if (local && instance) {
      const primary: AdditionalWebhookTarget = {
        enabled: Boolean(instance.enabled),
        url: instance.url,
        headers: instance.headers as Record<string, string>,
        byEvents: instance.webhookByEvents,
        events: instance.events as string[],
      };
      const additional = Array.isArray(instance.additionalTargets)
        ? (instance.additionalTargets as AdditionalWebhookTarget[])
        : [];
      for (const target of [primary, ...additional]) {
        if (!target.enabled || !target.url || (target.events?.length && !target.events.includes(we))) continue;
        deliveries.push(this.deliverTarget(target, payload, transformedWe, origin, serverUrl, enabledLog, webhookConfig));
      }
    }

    if (webhookConfig.GLOBAL?.ENABLED && webhookConfig.EVENTS[we]) {
      deliveries.push(this.deliverTarget({
        enabled: true,
        url: webhookConfig.GLOBAL.URL,
        byEvents: webhookConfig.GLOBAL.WEBHOOK_BY_EVENTS,
      }, payload, transformedWe, `${origin}-Global`, serverUrl, enabledLog, webhookConfig));
    }
    // A failed destination cannot prevent delivery to a different destination.
    await Promise.all(deliveries);
  }

  private async deliverTarget(
    target: AdditionalWebhookTarget,
    payload: Record<string, any>,
    eventPath: string,
    origin: string,
    serverUrl: string,
    enabledLog: boolean,
    config: Webhook,
  ): Promise<void> {
    let baseURL = target.url;
    try {
      const parsed = new URL(baseURL);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      if (target.byEvents) {
        parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/${eventPath}`;
        baseURL = parsed.toString();
      }
      const headers = { ...(target.headers ?? {}) };
      if ('jwt_key' in headers) {
        headers.Authorization = `Bearer ${this.generateJwtToken(headers.jwt_key)}`;
        delete headers.jwt_key;
      }
      const body = { ...payload, destination: target.url };
      if (enabledLog) this.logger.log({ local: `${origin}.sendData-Webhook`, url: baseURL, ...body });
      const httpService = axios.create({
        baseURL,
        headers,
        timeout: config.REQUEST?.TIMEOUT_MS ?? 30000,
      });
      await this.retryWebhookRequest(httpService, body, `${origin}.sendData-Webhook`, baseURL, serverUrl);
    } catch (error) {
      this.logger.error({
        local: `${origin}.sendData-Webhook`,
        message: `Todas as tentativas falharam: ${error?.message}`,
        statusCode: error?.response?.status,
        url: baseURL,
        server_url: serverUrl,
      });
    }
  }

  private async retryWebhookRequest(
    httpService: AxiosInstance,
    webhookData: any,
    origin: string,
    baseURL: string,
    serverUrl: string,
    maxRetries?: number,
    delaySeconds?: number,
  ): Promise<void> {
    const webhookConfig = configService.get<Webhook>('WEBHOOK');
    const maxRetryAttempts = maxRetries ?? webhookConfig.RETRY?.MAX_ATTEMPTS ?? 10;
    const initialDelay = delaySeconds ?? webhookConfig.RETRY?.INITIAL_DELAY_SECONDS ?? 5;
    const useExponentialBackoff = webhookConfig.RETRY?.USE_EXPONENTIAL_BACKOFF ?? true;
    const maxDelay = webhookConfig.RETRY?.MAX_DELAY_SECONDS ?? 300;
    const jitterFactor = webhookConfig.RETRY?.JITTER_FACTOR ?? 0.2;
    const nonRetryableStatusCodes = webhookConfig.RETRY?.NON_RETRYABLE_STATUS_CODES ?? [400, 401, 403, 404, 422];

    let attempts = 0;
    // Only routing metadata enters diagnostics. The webhook body, credentials,
    // destination URL and response body are deliberately excluded.
    const event = String(webhookData?.event || '')
      .replace(/[.-]/g, '_')
      .toUpperCase();
    const delivery = {
      code: 'webhook.delivery',
      component: 'native-webhook',
      traceId: diagnostics.traceId() ?? randomUUID(),
      instanceId: webhookData?.instance,
      targetId: createHash('sha256').update(baseURL).digest('hex').slice(0, 12),
      event,
      callId:
        event === 'CALL'
          ? webhookData?.data?.call?.callId || webhookData?.data?.callId || webhookData?.data?.id
          : undefined,
    };

    while (attempts < maxRetryAttempts) {
      const started = Date.now();
      diagnostics.record({ ...delivery, phase: 'started', attempt: attempts + 1 });
      try {
        const response = await httpService.post('', webhookData);
        diagnostics.record({
          ...delivery,
          phase: 'succeeded',
          attempt: attempts + 1,
          status: response.status,
          durationMs: Date.now() - started,
        });
        if (attempts > 0) {
          this.logger.log({
            local: `${origin}`,
            message: `Sucesso no envio após ${attempts + 1} tentativas`,
            url: baseURL,
          });
        }
        return;
      } catch (error) {
        attempts++;
        diagnostics.record({
          ...delivery,
          level: 'error',
          phase: 'failed',
          attempt: attempts,
          status: error?.response?.status,
          durationMs: Date.now() - started,
          error,
        });

        const isTimeout = error.code === 'ECONNABORTED';

        if (error?.response?.status && nonRetryableStatusCodes.includes(error.response.status)) {
          this.logger.error({
            local: `${origin}`,
            message: `Erro não recuperável (${error.response.status}): ${error?.message}. Cancelando retentativas.`,
            statusCode: error?.response?.status,
            url: baseURL,
            server_url: serverUrl,
          });
          throw error;
        }

        this.logger.error({
          local: `${origin}`,
          message: `Tentativa ${attempts}/${maxRetryAttempts} falhou: ${isTimeout ? 'Timeout da requisição' : error?.message}`,
          hostName: error?.hostname,
          syscall: error?.syscall,
          code: error?.code,
          isTimeout,
          statusCode: error?.response?.status,
          error: error?.errno,
          stack: error?.stack,
          name: error?.name,
          url: baseURL,
          server_url: serverUrl,
        });

        if (attempts === maxRetryAttempts) {
          throw error;
        }

        let nextDelay = initialDelay;
        if (useExponentialBackoff) {
          nextDelay = Math.min(initialDelay * Math.pow(2, attempts - 1), maxDelay);

          const jitter = nextDelay * jitterFactor * (Math.random() * 2 - 1);
          nextDelay = Math.max(initialDelay, nextDelay + jitter);
        }

        this.logger.log({
          local: `${origin}`,
          message: `Aguardando ${nextDelay.toFixed(1)} segundos antes da próxima tentativa`,
          url: baseURL,
        });

        await new Promise((resolve) => setTimeout(resolve, nextDelay * 1000));
      }
    }
  }

  private generateJwtToken(authToken: string): string {
    try {
      const payload = {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600, // 10 min expiration
        app: 'connect',
        action: 'webhook',
      };

      const token = jwt.sign(payload, authToken, { algorithm: 'HS256' });
      return token;
    } catch (error) {
      this.logger.error({
        local: 'WebhookController.generateJwtToken',
        message: `JWT generation failed: ${error?.message}`,
      });
      throw error;
    }
  }
}
