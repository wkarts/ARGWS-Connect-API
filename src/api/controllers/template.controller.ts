import { InstanceDto } from '@api/dto/instance.dto';
import { TemplateDeleteDto, TemplateDto, TemplateEditDto, TemplatePreviewDto } from '@api/dto/template.dto';
import { TemplateService } from '@api/services/template.service';

export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  public async createTemplate(instance: InstanceDto, data: TemplateDto) {
    return this.templateService.create(instance, data);
  }

  public async findTemplate(instance: InstanceDto) {
    return this.templateService.find(instance);
  }

  public async capabilities(instance: InstanceDto) {
    return this.templateService.capabilities(instance);
  }

  public async previewTemplate(instance: InstanceDto, data: TemplatePreviewDto) {
    return this.templateService.preview(instance, data);
  }

  public async editTemplate(instance: InstanceDto, data: TemplateEditDto) {
    return this.templateService.edit(instance, data);
  }

  public async deleteTemplate(instance: InstanceDto, data: TemplateDeleteDto) {
    return this.templateService.delete(instance, data);
  }
}
