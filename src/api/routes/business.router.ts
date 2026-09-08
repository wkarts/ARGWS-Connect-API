import { RouterBroker } from '@api/abstract/abstract.router';
import { getCatalogDto, getCollectionsDto } from '@api/dto/business.dto';
import { businessController } from '@api/server.module';
import { createMetaErrorResponse } from '@utils/errorResponse';
import { catalogSchema, collectionsSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class BusinessRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('getCatalog'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<getCatalogDto>({
            request: req,
            schema: catalogSchema,
            ClassRef: getCatalogDto,
            execute: (instance, data) => businessController.fetchCatalog(instance, data),
          });

          return res.status(HttpStatus.OK).json(response);
        } catch (error) {
          // Log error for debugging
          console.error('Business catalog error:', error);

          // Use utility function to create standardized error response
          const errorResponse = createMetaErrorResponse(error, 'business_catalog');
          return res.status(errorResponse.status).json(errorResponse);
        }
      })

      .post(this.routerPath('getCollections'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<getCollectionsDto>({
            request: req,
            schema: collectionsSchema,
            ClassRef: getCollectionsDto,
            execute: (instance, data) => businessController.fetchCollections(instance, data),
          });

          return res.status(HttpStatus.OK).json(response);
        } catch (error) {
          // Log error for debugging
          console.error('Business collections error:', error);

          // Use utility function to create standardized error response
          const errorResponse = createMetaErrorResponse(error, 'business_collections');
          return res.status(errorResponse.status).json(errorResponse);
        }
      });
  }

  public readonly router: Router = Router();
}
