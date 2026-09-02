import { InstanceDto } from '@api/dto/instance.dto';
import { SendTemplateDto } from '@api/dto/sendMessage.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { BadRequestException, NotFoundException } from '@exceptions';

import { WAMonitoringService } from './monitor.service';
import { renderTemplateDefinition } from './template-renderer';

export class TemplateEngineService {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly prisma: PrismaRepository,
  ) {}

  public async send(instance: InstanceDto, data: SendTemplateDto) {
    const runtime = this.waMonitor.waInstances[instance.instanceName];
    if (!runtime) throw new NotFoundException(`Instance ${instance.instanceName} not found`);

    const provider = instance.integration || runtime.instance?.integration;

    // Meta Business remains provider-native: the approved Meta template is sent unchanged.
    if (provider === 'WHATSAPP-BUSINESS') {
      return runtime.templateMessage(data);
    }

    const template = await this.prisma.template.findFirst({
      where: {
        instanceId: instance.instanceId,
        name: data.name,
        language: data.language || 'pt_BR',
        enabled: true,
      },
    });

    if (!template) {
      throw new NotFoundException(`Template ${data.name} (${data.language || 'pt_BR'}) not found for this instance`);
    }

    const definition: any = template.template || {};
    const rendered = renderTemplateDefinition(
      definition,
      Array.isArray(data.components) ? data.components : [],
      data.variables || {},
    );

    if (!rendered.text && !rendered.title) {
      throw new BadRequestException(`Template ${data.name} has no renderable text content for provider ${provider}`);
    }

    if (rendered.buttons.length) {
      return runtime.buttonMessage({
        number: data.number,
        title: rendered.title || rendered.text || data.name,
        description: rendered.text || undefined,
        footer: rendered.footer,
        buttons: rendered.buttons,
        delay: data.delay,
        quoted: data.quoted,
        mentionsEveryOne: data.mentionsEveryOne,
        mentioned: data.mentioned,
      });
    }

    return runtime.textMessage({
      number: data.number,
      text: rendered.text || rendered.title,
      delay: data.delay,
      quoted: data.quoted,
      linkPreview: data.linkPreview,
      mentionsEveryOne: data.mentionsEveryOne,
      mentioned: data.mentioned,
    });
  }
}
