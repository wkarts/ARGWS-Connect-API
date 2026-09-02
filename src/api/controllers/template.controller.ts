import { InstanceDto } from '@api/dto/instance.dto';
import { TemplateDeleteDto, TemplateDto, TemplateEditDto, TemplatePreviewDto } from '@api/dto/template.dto';
import { renderInteractionModelV2 } from '@api/services/template-interaction-model';
import { mergePolicyInteractionBindings } from '@api/services/template-policy-bindings';
import { TemplateService } from '@api/services/template.service';
import { planTemplateTransport } from '@api/services/template-transport-planner';

export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  public async createTemplate(instance: InstanceDto, data: TemplateDto) {
    data.actions = mergePolicyInteractionBindings(data.actions, data.policy);
    return this.templateService.create(instance, data);
  }

  public async findTemplate(instance: InstanceDto) {
    return this.templateService.find(instance);
  }

  public async capabilities(instance: InstanceDto) {
    return this.templateService.capabilities(instance);
  }

  public async previewTemplate(instance: InstanceDto, data: TemplatePreviewDto) {
    const preview: any = await this.templateService.preview(instance, data);
    let policy: Record<string, unknown> = data.policy || {};

    if (!Array.isArray(data.components) && data.name) {
      if (preview.provider === 'WHATSAPP-BUSINESS') {
        const templates: any = await this.templateService.find(instance);
        const list = Array.isArray(templates) ? templates : Array.isArray(templates?.data) ? templates.data : [];
        const selected = list.find(
          (template: any) =>
            template.name === data.name && String(template.language || 'pt_BR') === String(data.language || 'pt_BR'),
        );
        if (selected?.policy && typeof selected.policy === 'object') policy = selected.policy;
      } else {
        const instanceRow = await this.templateService.prismaRepository.instance.findUnique({
          where: { name: instance.instanceName },
          select: { id: true },
        });
        if (instanceRow) {
          const selected = await this.templateService.prismaRepository.template.findFirst({
            where: {
              instanceId: instanceRow.id,
              name: data.name,
              language: data.language || 'pt_BR',
            },
            select: { policy: true },
          });
          if (selected?.policy && typeof selected.policy === 'object') {
            policy = selected.policy as Record<string, unknown>;
          }
        }
      }
    }

    const interactions = renderInteractionModelV2(policy, data.variables || {});
    const rendered = {
      ...(preview.rendered || { text: '', buttons: [] }),
      interactions,
    };
    const transport = planTemplateTransport(preview.provider, rendered);

    return {
      ...preview,
      transport,
      plan: transport,
      rendered,
    };
  }

  public async editTemplate(instance: InstanceDto, data: TemplateEditDto) {
    if (data.policy !== undefined) {
      const instanceRow = await this.templateService.prismaRepository.instance.findUnique({
        where: { name: instance.instanceName },
        select: { id: true },
      });
      const existing = instanceRow
        ? await this.templateService.prismaRepository.template.findFirst({
            where: {
              instanceId: instanceRow.id,
              OR: [{ templateId: data.templateId }, { externalTemplateId: data.templateId }],
            },
            select: { actions: true },
          })
        : null;
      data.actions = mergePolicyInteractionBindings(data.actions ?? existing?.actions, data.policy);
    }
    return this.templateService.edit(instance, data);
  }

  public async deleteTemplate(instance: InstanceDto, data: TemplateDeleteDto) {
    return this.templateService.delete(instance, data);
  }
}
