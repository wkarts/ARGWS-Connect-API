import { RabbitmqController } from '@api/integrations/event/rabbitmq/rabbitmq.controller';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import { Channel, Message } from 'amqplib/callback_api';
import axios from 'axios';

import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { MetaCloudWebhookSerializer } from './meta-cloud-webhook.serializer';
import { MetaCloudEventData, MetaCloudWebhookEnvelope } from './types/meta-webhook.types';

export class MetaCloudWebhookDispatcher {
  private readonly logger = new Logger('MetaCloudWebhookDispatcher');
  private consumerChannel: Channel | null = null;
  private consuming = false;
  private readonly mainQueue = 'argws.meta-compat.webhook';
  private readonly retryQueues = [
    { name: 'argws.meta-compat.webhook.retry.5s', ttl: 5000 },
    { name: 'argws.meta-compat.webhook.retry.30s', ttl: 30000 },
    { name: 'argws.meta-compat.webhook.retry.120s', ttl: 120000 },
  ];
  private readonly dlq = 'argws.meta-compat.webhook.dlq';

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly resolver: MetaCloudIdentityResolver,
    private readonly serializer: MetaCloudWebhookSerializer,
    private readonly rabbitmq: RabbitmqController,
  ) {}

  public async handleEvent(eventData: MetaCloudEventData): Promise<void> {
    if (!['messages.upsert', 'messages.update', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'].includes(eventData.event)) return;
    try {
      const identity = await this.resolver.resolveByInstanceName(eventData.instanceName);
      const config = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
      if (!config?.webhookUrl) return;
      const payload = await this.serializer.serialize(eventData);
      if (!payload) return;
      const envelope: MetaCloudWebhookEnvelope = {
        webhookUrl: config.webhookUrl,
        payload,
        context: {
          instanceId: identity.instanceId,
          instanceName: identity.instanceName,
          provider: identity.provider,
          phoneNumberId: identity.phoneNumberId,
          messageId: this.extractMessageId(payload),
        },
        attempt: 0,
      };
      if (await this.enqueue(envelope)) return;
      void this.deliverWithBackoff(envelope);
    } catch (error) {
      this.logger.error({
        metaCompatibility: true,
        operation: 'webhook.serialize',
        instanceName: eventData.instanceName,
        error: error?.message || String(error),
      });
    }
  }

  private async enqueue(envelope: MetaCloudWebhookEnvelope): Promise<boolean> {
    const channel = this.rabbitmq?.channel;
    if (!channel) return false;
    try {
      await this.ensureQueues(channel);
      channel.sendToQueue(this.mainQueue, Buffer.from(JSON.stringify(envelope)), { persistent: true });
      return true;
    } catch (error) {
      this.logger.warn({
        metaCompatibility: true,
        operation: 'webhook.enqueue',
        instanceName: envelope.context.instanceName,
        error: error?.message || String(error),
      });
      return false;
    }
  }

  private async ensureQueues(channel: Channel) {
    if (this.consumerChannel === channel && this.consuming) return;
    this.consumerChannel = channel;
    await channel.assertQueue(this.mainQueue, { durable: true });
    await channel.assertQueue(this.dlq, { durable: true });
    for (const retry of this.retryQueues) {
      await channel.assertQueue(retry.name, {
        durable: true,
        arguments: {
          'x-message-ttl': retry.ttl,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': this.mainQueue,
        },
      });
    }
    if (!this.consuming) {
      this.consuming = true;
      channel.consume(this.mainQueue, (message) => void this.consume(channel, message), { noAck: false });
    }
  }

  private async consume(channel: Channel, message: Message | null) {
    if (!message) return;
    let envelope: MetaCloudWebhookEnvelope;
    try {
      envelope = JSON.parse(message.content.toString('utf8'));
    } catch {
      channel.ack(message);
      return;
    }
    try {
      await this.deliver(envelope);
      channel.ack(message);
    } catch (error) {
      const nextAttempt = envelope.attempt + 1;
      const retry = this.retryQueues[nextAttempt - 1];
      if (retry) {
        channel.sendToQueue(retry.name, Buffer.from(JSON.stringify({ ...envelope, attempt: nextAttempt })), {
          persistent: true,
        });
      } else {
        channel.sendToQueue(this.dlq, Buffer.from(JSON.stringify({ ...envelope, attempt: nextAttempt })), {
          persistent: true,
        });
        metaCloudMetrics.increment('connect_meta_compat_webhook_failures_total');
      }
      channel.ack(message);
      this.logger.warn({
        metaCompatibility: true,
        operation: 'webhook.retry',
        instanceId: envelope.context.instanceId,
        instanceName: envelope.context.instanceName,
        provider: envelope.context.provider,
        phoneNumberId: envelope.context.phoneNumberId,
        messageId: envelope.context.messageId,
        attempt: nextAttempt,
        error: error?.message || String(error),
      });
    }
  }

  private async deliverWithBackoff(envelope: MetaCloudWebhookEnvelope) {
    const delays = [0, 5000, 30000, 120000];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      try {
        await this.deliver({ ...envelope, attempt });
        return;
      } catch (error) {
        if (attempt === delays.length - 1) {
          metaCloudMetrics.increment('connect_meta_compat_webhook_failures_total');
          this.logger.error({
            metaCompatibility: true,
            operation: 'webhook.failed',
            instanceId: envelope.context.instanceId,
            instanceName: envelope.context.instanceName,
            provider: envelope.context.provider,
            phoneNumberId: envelope.context.phoneNumberId,
            messageId: envelope.context.messageId,
            error: error?.message || String(error),
          });
        }
      }
    }
  }

  private async deliver(envelope: MetaCloudWebhookEnvelope) {
    await axios.post(envelope.webhookUrl, envelope.payload, {
      timeout: 10_000,
      headers: { 'content-type': 'application/json', 'user-agent': 'ARGWS-Connect-Meta-Compatibility/1' },
      maxRedirects: 3,
    });
    metaCloudMetrics.increment('connect_meta_compat_webhooks_total');
  }

  private extractMessageId(payload: any) {
    return (
      payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ||
      payload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id
    );
  }
}
