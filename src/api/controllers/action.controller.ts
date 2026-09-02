import { ActionDeleteDto, ActionExecuteDto, IntegrationActionDto } from '@api/dto/action.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { ActionExecutionService } from '@api/services/action-execution.service';
import { ActionRegistryService } from '@api/services/action-registry.service';

export class ActionController {
  constructor(
    private readonly registry: ActionRegistryService,
    private readonly execution: ActionExecutionService,
  ) {}

  public create(instance: InstanceDto, data: IntegrationActionDto) {
    return this.registry.create(instance, data);
  }

  public find(instance: InstanceDto) {
    return this.registry.find(instance);
  }

  public delete(instance: InstanceDto, data: ActionDeleteDto) {
    return this.registry.delete(instance, data);
  }

  public execute(instance: InstanceDto, data: ActionExecuteDto) {
    return this.execution.execute(instance, data);
  }
}
