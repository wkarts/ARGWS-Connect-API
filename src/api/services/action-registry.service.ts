import { ActionDeleteDto, IntegrationActionDto } from '@api/dto/action.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { BadRequestException } from '@exceptions';

const SECRET_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'api-key', 'apikey']);
const ACTION_KEY = /^[a-z0-9][a-z0-9._:-]{1,149}$/i;
const CREDENTIAL_REF = /^[A-Z0-9_-]{2,100}$/i;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export class ActionRegistryService {
  constructor(private readonly prisma: PrismaRepository) {}

  public async create(instance: InstanceDto, data: IntegrationActionDto) {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    this.validateDefinition(data);

    return this.prisma.integrationAction.upsert({
      where: { instanceId_actionKey: { instanceId, actionKey: data.actionKey } },
      create: {
        instanceId,
        actionKey: data.actionKey,
        name: data.name,
        description: data.description,
        method: data.method.toUpperCase(),
        baseUrl: data.baseUrl,
        path: data.path,
        credentialRef: data.credentialRef,
        headers: (data.headers || {}) as any,
        requestTemplate: (data.requestTemplate || {}) as any,
        inputSchema: data.inputSchema as any,
        outputMapping: data.outputMapping as any,
        timeoutMs: data.timeoutMs ?? 10000,
        confirmation: data.confirmation || 'NONE',
        allowPrivateNetwork: data.allowPrivateNetwork ?? false,
        enabled: data.enabled ?? true,
      },
      update: {
        name: data.name,
        description: data.description,
        method: data.method.toUpperCase(),
        baseUrl: data.baseUrl,
        path: data.path,
        credentialRef: data.credentialRef,
        headers: (data.headers || {}) as any,
        requestTemplate: (data.requestTemplate || {}) as any,
        inputSchema: data.inputSchema as any,
        outputMapping: data.outputMapping as any,
        timeoutMs: data.timeoutMs ?? 10000,
        confirmation: data.confirmation || 'NONE',
        allowPrivateNetwork: data.allowPrivateNetwork ?? false,
        enabled: data.enabled ?? true,
      },
    });
  }

  public async find(instance: InstanceDto) {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    return this.prisma.integrationAction.findMany({ where: { instanceId }, orderBy: { actionKey: 'asc' } });
  }

  public async delete(instance: InstanceDto, data: ActionDeleteDto) {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    const result = await this.prisma.integrationAction.deleteMany({ where: { instanceId, actionKey: data.actionKey } });
    return { deleted: result.count > 0, actionKey: data.actionKey };
  }

  private validateDefinition(data: IntegrationActionDto) {
    if (!ACTION_KEY.test(data.actionKey || '')) throw new BadRequestException('Invalid actionKey.');
    if (!METHODS.has(String(data.method || '').toUpperCase()))
      throw new BadRequestException('Invalid action HTTP method.');
    if (data.credentialRef && !CREDENTIAL_REF.test(data.credentialRef)) {
      throw new BadRequestException('credentialRef must contain only letters, numbers, underscore or dash.');
    }
    if ((data.timeoutMs ?? 10000) < 250 || (data.timeoutMs ?? 10000) > 60000) {
      throw new BadRequestException('timeoutMs must be between 250 and 60000.');
    }
    if (/^https?:\/\//i.test(data.path || '')) {
      throw new BadRequestException('Action path must be relative. Configure the host only in baseUrl.');
    }

    let url: URL;
    try {
      url = new URL(data.baseUrl);
    } catch {
      throw new BadRequestException('baseUrl must be a valid HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new BadRequestException('baseUrl must use HTTP or HTTPS.');
    if (url.username || url.password) throw new BadRequestException('Credentials must not be embedded in baseUrl.');

    for (const header of Object.keys(data.headers || {})) {
      if (SECRET_HEADERS.has(header.toLowerCase())) {
        throw new BadRequestException(`Header ${header} is credential-like. Use credentialRef instead.`);
      }
    }
  }

  private async resolveInstanceId(instanceName: string) {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true } });
    if (!instance) throw new BadRequestException(`Instance ${instanceName} was not found.`);
    return instance.id;
  }
}
