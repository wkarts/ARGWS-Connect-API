import { InstanceDto } from '@api/dto/instance.dto';
import { RecipeDeleteDto, RecipeDto, RecipeExecuteDto, RecipeInstallDto } from '@api/dto/recipe.dto';
import { RecipeService } from '@api/services/recipe.service';
import { RecipeLibraryService } from '@api/services/recipe-library.service';

export class RecipeController {
  constructor(
    private readonly service: RecipeService,
    private readonly libraryService: RecipeLibraryService,
  ) {}

  public library() {
    return this.libraryService.list();
  }

  public install(instance: InstanceDto, data: RecipeInstallDto) {
    return this.libraryService.install(instance, data);
  }

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
