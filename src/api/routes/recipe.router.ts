import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { RecipeDeleteDto, RecipeDto, RecipeExecuteDto, RecipeInstallDto } from '@api/dto/recipe.dto';
import { recipeController } from '@api/server.module';
import { createMetaErrorResponse } from '@utils/errorResponse';
import { recipeDeleteSchema, recipeExecuteSchema, recipeInstallSchema, recipeSchema } from '@validate/recipe.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class RecipeRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .get(this.routerPath('library'), ...guards, async (req, res) => {
        try {
          res.status(HttpStatus.OK).json(await recipeController.library());
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_library');
          res.status(response.status).json(response);
        }
      })
      .post(this.routerPath('install'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<RecipeInstallDto>({
            request: req,
            schema: recipeInstallSchema,
            ClassRef: RecipeInstallDto,
            execute: (instance, data) => recipeController.install(instance, data),
          });
          res.status(HttpStatus.CREATED).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_install');
          res.status(response.status).json(response);
        }
      })
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
