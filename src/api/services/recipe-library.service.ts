import { InstanceDto } from '@api/dto/instance.dto';
import { RecipeInstallDto } from '@api/dto/recipe.dto';
import { schedulerProRecipePackage } from '@api/recipes/official/scheduler-pro';
import { PrismaRepository } from '@api/repository/repository.service';
import { BadRequestException } from '@exceptions';

import { ActionRegistryService } from './action-registry.service';
import { RecipeService } from './recipe.service';

const PACKAGES = [schedulerProRecipePackage] as const;

export class RecipeLibraryService {
  constructor(
    private readonly prisma: PrismaRepository,
    private readonly actionRegistry: ActionRegistryService,
    private readonly recipes: RecipeService,
  ) {}

  public list() {
    return PACKAGES.map((item) => ({
      packageKey: item.packageKey,
      name: item.name,
      description: item.description,
      version: item.version,
      credentialRef: item.credentialRef,
      actions: item.actions.map((action) => action.actionKey),
      recipes: item.recipes.map((recipe) => recipe.recipeKey),
      templates: item.templates.map((template) => `${template.name}:${template.language}`),
    }));
  }

  public async install(instance: InstanceDto, data: RecipeInstallDto) {
    const definition = PACKAGES.find((item) => item.packageKey === data.packageKey);
    if (!definition) throw new BadRequestException(`Recipe package ${data.packageKey} was not found.`);

    let baseUrl: URL;
    try {
      baseUrl = new URL(data.baseUrl);
    } catch {
      throw new BadRequestException('baseUrl must be a valid HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(baseUrl.protocol)) {
      throw new BadRequestException('baseUrl must use HTTP or HTTPS.');
    }

    const credentialRef = data.credentialRef || definition.credentialRef;
    for (const action of definition.actions) {
      await this.actionRegistry.create(instance, {
        ...action,
        method: action.method as any,
        confirmation: action.confirmation as any,
        baseUrl: baseUrl.toString(),
        credentialRef,
        allowPrivateNetwork: data.allowPrivateNetwork ?? false,
        enabled: true,
      });
    }

    for (const recipe of definition.recipes) {
      await this.recipes.create(instance, {
        ...recipe,
        confirmation: recipe.confirmation as any,
        steps: recipe.steps.map((step) => ({ ...step })) as any,
        enabled: true,
      });
    }

    const instanceRow = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true },
    });
    if (!instanceRow) throw new BadRequestException(`Instance ${instance.instanceName} was not found.`);

    for (const template of definition.templates) {
      const templateId = `system:${definition.packageKey}:${template.name}:${template.language}`;
      const payload = {
        name: template.name,
        language: template.language,
        category: template.category,
        status: 'APPROVED',
        components: template.components,
      };
      await this.prisma.template.upsert({
        where: {
          instanceId_name_language: {
            instanceId: instanceRow.id,
            name: template.name,
            language: template.language,
          },
        },
        create: {
          instanceId: instanceRow.id,
          templateId,
          name: template.name,
          language: template.language,
          category: template.category,
          status: 'APPROVED',
          origin: 'SYSTEM',
          enabled: true,
          isDefault: true,
          template: payload as any,
          actions: template.actions as any,
          policy: template.policy as any,
        },
        update: {
          category: template.category,
          status: 'APPROVED',
          origin: 'SYSTEM',
          enabled: true,
          isDefault: true,
          template: payload as any,
          actions: template.actions as any,
          policy: template.policy as any,
        },
      });
    }

    return {
      installed: true,
      packageKey: definition.packageKey,
      version: definition.version,
      baseUrl: baseUrl.toString(),
      credentialRef,
      actionCount: definition.actions.length,
      recipeCount: definition.recipes.length,
      templateCount: definition.templates.length,
    };
  }
}
