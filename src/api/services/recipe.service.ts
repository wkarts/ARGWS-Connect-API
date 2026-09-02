import { ActionExecuteDto } from '@api/dto/action.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { RecipeDeleteDto, RecipeDto, RecipeExecuteDto, RecipeStepDto } from '@api/dto/recipe.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { BadRequestException } from '@exceptions';
import { validate } from 'jsonschema';

import { ActionExecutionService } from './action-execution.service';
import { resolveActionValue } from './action-value-resolver';

const RECIPE_KEY = /^[a-z0-9][a-z0-9._:-]{1,149}$/i;

export class RecipeService {
  constructor(
    private readonly prisma: PrismaRepository,
    private readonly actionExecution: ActionExecutionService,
  ) {}

  public async create(instance: InstanceDto, data: RecipeDto) {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    this.validateDefinition(data);

    return this.prisma.recipe.upsert({
      where: { instanceId_recipeKey: { instanceId, recipeKey: data.recipeKey } },
      create: {
        instanceId,
        recipeKey: data.recipeKey,
        name: data.name,
        description: data.description,
        version: data.version ?? 1,
        steps: data.steps as any,
        inputSchema: data.inputSchema as any,
        outputTemplate: data.outputTemplate as any,
        confirmation: data.confirmation || 'NONE',
        enabled: data.enabled ?? true,
      },
      update: {
        name: data.name,
        description: data.description,
        version: data.version ?? 1,
        steps: data.steps as any,
        inputSchema: data.inputSchema as any,
        outputTemplate: data.outputTemplate as any,
        confirmation: data.confirmation || 'NONE',
        enabled: data.enabled ?? true,
      },
    });
  }

  public async find(instance: InstanceDto) {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    return this.prisma.recipe.findMany({ where: { instanceId }, orderBy: { recipeKey: 'asc' } });
  }

  public async delete(instance: InstanceDto, data: RecipeDeleteDto) {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    const result = await this.prisma.recipe.deleteMany({ where: { instanceId, recipeKey: data.recipeKey } });
    return { deleted: result.count > 0, recipeKey: data.recipeKey };
  }

  public async execute(instance: InstanceDto, data: RecipeExecuteDto) {
    const instanceId = await this.resolveInstanceId(instance.instanceName);
    const recipe = await this.prisma.recipe.findUnique({
      where: { instanceId_recipeKey: { instanceId, recipeKey: data.recipeKey } },
    });
    if (!recipe || !recipe.enabled) throw new BadRequestException(`Recipe ${data.recipeKey} is unavailable.`);
    this.validateInput(data.input || {}, recipe.inputSchema);
    if (!data.dryRun && recipe.confirmation !== 'NONE' && !data.confirmed) {
      throw new BadRequestException(`Recipe ${data.recipeKey} requires confirmation: ${recipe.confirmation}.`);
    }

    const steps = (Array.isArray(recipe.steps) ? recipe.steps : []) as RecipeStepDto[];
    const context: Record<string, unknown> = { input: data.input || {}, steps: {} };
    const results: Array<Record<string, unknown>> = [];

    for (const step of steps) {
      const resolvedInput = resolveActionValue(step.input ?? {}, context) as Record<string, unknown>;
      const actionRequest: ActionExecuteDto = {
        actionKey: step.action,
        input: resolvedInput,
        confirmed: data.confirmed,
        dryRun: data.dryRun,
        recipeKey: recipe.recipeKey,
      };

      try {
        const actionResult = await this.actionExecution.execute(instance, actionRequest);
        const row = { id: step.id, action: step.action, result: actionResult };
        results.push(row);
        (context.steps as Record<string, unknown>)[step.id] = actionResult;
      } catch (error) {
        const failure = {
          id: step.id,
          action: step.action,
          error: error instanceof Error ? error.message : error,
        };
        results.push(failure);
        (context.steps as Record<string, unknown>)[step.id] = failure;
        if (!step.continueOnError) throw error;
      }
    }

    const output = recipe.outputTemplate ? resolveActionValue(recipe.outputTemplate, context) : context.steps;
    return {
      recipeKey: recipe.recipeKey,
      version: recipe.version,
      dryRun: Boolean(data.dryRun),
      success: true,
      steps: results,
      output,
    };
  }

  private validateDefinition(data: RecipeDto) {
    if (!RECIPE_KEY.test(data.recipeKey || '')) throw new BadRequestException('Invalid recipeKey.');
    if (!Array.isArray(data.steps) || data.steps.length === 0) {
      throw new BadRequestException('Recipe requires at least one step.');
    }

    const ids = new Set<string>();
    for (const step of data.steps) {
      if (!step?.id || !RECIPE_KEY.test(step.id)) throw new BadRequestException('Every recipe step needs a valid id.');
      if (!step?.action || !RECIPE_KEY.test(step.action)) {
        throw new BadRequestException(`Step ${step.id} needs a valid action key.`);
      }
      if (ids.has(step.id)) throw new BadRequestException(`Duplicate recipe step id: ${step.id}.`);
      ids.add(step.id);
    }
  }

  private validateInput(input: Record<string, unknown>, schema: unknown) {
    if (!schema || typeof schema !== 'object') return;
    const result = validate(input, schema as any);
    if (!result.valid) throw new BadRequestException(result.errors.map((item) => item.stack));
  }

  private async resolveInstanceId(instanceName: string) {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true } });
    if (!instance) throw new BadRequestException(`Instance ${instanceName} was not found.`);
    return instance.id;
  }
}
