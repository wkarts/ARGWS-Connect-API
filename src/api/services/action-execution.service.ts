import dns from 'node:dns/promises';
import net from 'node:net';

import { ActionExecuteDto } from '@api/dto/action.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { BadRequestException } from '@exceptions';
import axios from 'axios';

import { resolveActionValue } from './action-value-resolver';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class ActionExecutionService {
  constructor(private readonly prisma: PrismaRepository) {}

  public async execute(instance: InstanceDto, data: ActionExecuteDto) {
    const instanceRow = await this.prisma.instance.findUnique({ where: { name: instance.instanceName }, select: { id: true } });
    if (!instanceRow) throw new BadRequestException(`Instance ${instance.instanceName} was not found.`);

    const action = await this.prisma.integrationAction.findUnique({
      where: { instanceId_actionKey: { instanceId: instanceRow.id, actionKey: data.actionKey } },
    });
    if (!action || !action.enabled) throw new BadRequestException(`Action ${data.actionKey} is unavailable.`);
    if (action.confirmation !== 'NONE' && !data.confirmed) {
      throw new BadRequestException(`Action ${data.actionKey} requires confirmation: ${action.confirmation}.`);
    }

    const context = { input: data.input || {} };
    const template = (action.requestTemplate || {}) as Record<string, unknown>;
    const path = String(resolveActionValue(action.path, context) || '');
    const baseUrl = new URL(action.baseUrl);
    const target = new URL(path || '.', baseUrl);
    if (target.origin !== baseUrl.origin) throw new BadRequestException('Action path cannot change the configured origin.');
    await this.assertTargetAllowed(target, action.allowPrivateNetwork);

    const resolvedTemplate = resolveActionValue(template, context) as Record<string, unknown>;
    const method = action.method.toUpperCase();
    const params = resolvedTemplate?.query || (method === 'GET' ? data.input || {} : undefined);
    const body = resolvedTemplate?.body ?? (method === 'GET' ? undefined : data.input || {});
    const headers = {
      ...((action.headers || {}) as Record<string, string>),
      ...this.resolveCredentialHeaders(action.credentialRef),
    };

    const plan = {
      actionKey: action.actionKey,
      method,
      url: target.toString(),
      confirmation: action.confirmation,
      privateNetwork: action.allowPrivateNetwork,
      hasCredential: Boolean(action.credentialRef),
      query: params,
      body,
    };
    if (data.dryRun) return { dryRun: true, plan };

    const startedAt = new Date();
    const execution = await this.prisma.actionExecution.create({
      data: {
        instanceId: instanceRow.id,
        actionKey: action.actionKey,
        status: 'RUNNING',
        requestMeta: {
          method,
          url: target.toString(),
          hasCredential: Boolean(action.credentialRef),
        } as any,
        startedAt,
      },
    });

    try {
      const response = await axios.request({
        url: target.toString(),
        method,
        params,
        data: body,
        headers,
        timeout: action.timeoutMs,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        validateStatus: () => true,
      });

      const finishedAt = new Date();
      const success = response.status >= 200 && response.status < 300;
      await this.prisma.actionExecution.update({
        where: { id: execution.id },
        data: {
          status: success ? 'SUCCESS' : 'HTTP_ERROR',
          responseMeta: {
            status: response.status,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            contentType: response.headers?.['content-type'],
          } as any,
          finishedAt,
        },
      });

      return {
        actionKey: action.actionKey,
        executionId: execution.id,
        success,
        status: response.status,
        data: response.data,
      };
    } catch (error) {
      const finishedAt = new Date();
      await this.prisma.actionExecution.update({
        where: { id: execution.id },
        data: {
          status: 'FAILED',
          errorMeta: {
            message: error instanceof Error ? error.message : String(error),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          } as any,
          finishedAt,
        },
      });
      throw error;
    }
  }

  private resolveCredentialHeaders(credentialRef?: string | null): Record<string, string> {
    if (!credentialRef) return {};
    const envKey = `ARGWS_ACTION_CREDENTIAL_${credentialRef.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
    const raw = process.env[envKey];
    if (!raw) throw new BadRequestException(`Credential ${credentialRef} is not configured.`);

    let credential: any;
    try {
      credential = JSON.parse(raw);
    } catch {
      throw new BadRequestException(`Credential ${credentialRef} must be valid JSON.`);
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(credential.headers || {})) headers[key] = String(value);
    if (credential.bearer) headers.Authorization = `Bearer ${credential.bearer}`;
    if (credential.basic?.username !== undefined && credential.basic?.password !== undefined) {
      const token = Buffer.from(`${credential.basic.username}:${credential.basic.password}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }
    return headers;
  }

  private async assertTargetAllowed(target: URL, allowPrivateNetwork: boolean) {
    if (allowPrivateNetwork) return;
    const hostname = target.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new BadRequestException('Private/loopback targets require allowPrivateNetwork=true.');
    }

    if (net.isIP(hostname)) {
      if (this.isPrivateAddress(hostname)) throw new BadRequestException('Private target is blocked for this action.');
      return;
    }

    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => this.isPrivateAddress(item.address))) {
      throw new BadRequestException('Action target resolves to a private or unsupported address.');
    }
  }

  private isPrivateAddress(address: string) {
    if (address === '::1' || address === '::' || address.toLowerCase().startsWith('fc') || address.toLowerCase().startsWith('fd')) {
      return true;
    }
    if (address.toLowerCase().startsWith('fe8') || address.toLowerCase().startsWith('fe9') || address.toLowerCase().startsWith('fea') || address.toLowerCase().startsWith('feb')) {
      return true;
    }
    if (!net.isIPv4(address)) return false;
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
}
