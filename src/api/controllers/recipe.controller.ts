import { InstanceDto } from '@api/dto/instance.dto';
import { RecipeDeleteDto, RecipeDto, RecipeExecuteDto } from '@api/dto/recipe.dto';
import { RecipeService } from '@api/services/recipe.service';

export class RecipeController {
  constructor(private readonly service: RecipeService) {}

  public create(instance: InstanceDto, data: RecipeDto) {
    return this.service.create(instance, data);
  }

  public find(instance: InstanceDto) {
    return this.service.find(instance);
  }

  public delete(instance: InstanceDto, data: RecipeDeleteDto) {
    return this.service.delete(instance, data);
  }

  public execute(instance: InstanceDto, data: RecipeExecuteDto) {
    return this.service.execute(instance, data);
  }
}
