import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { RecipeDeleteDto, RecipeDto, RecipeExecuteDto } from '@api/dto/recipe.dto';
import { recipeController } from '@api/server.module';
import { createMetaErrorResponse } from '@utils/errorResponse';
import { recipeDeleteSchema, recipeExecuteSchema, recipeSchema } from '@validate/recipe.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class RecipeRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<RecipeDto>({
            request: req,
            schema: recipeSchema,
            ClassRef: RecipeDto,
            execute: (instance, data) => recipeController.create(instance, data),
          });
          res.status(HttpStatus.CREATED).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_create');
          res.status(response.status).json(response);
        }
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        try {
          const response = await recipeController.find(req.params as unknown as InstanceDto);
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_find');
          res.status(response.status).json(response);
        }
      })
      .post(this.routerPath('execute'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<RecipeExecuteDto>({
            request: req,
            schema: recipeExecuteSchema,
            ClassRef: RecipeExecuteDto,
            execute: (instance, data) => recipeController.execute(instance, data),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_execute');
          res.status(response.status).json(response);
        }
      })
      .delete(this.routerPath('delete'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<RecipeDeleteDto>({
            request: req,
            schema: recipeDeleteSchema,
            ClassRef: RecipeDeleteDto,
            execute: (instance, data) => recipeController.delete(instance, data),
          });
          res.status(HttpStatus.OK).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_delete');
          res.status(response.status).json(response);
        }
      });
  }

  public readonly router: Router = Router();
}
