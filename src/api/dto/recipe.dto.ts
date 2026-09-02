import { ActionConfirmation } from './action.dto';

export type RecipeStepDto = {
  id: string;
  action: string;
  input?: unknown;
  continueOnError?: boolean;
};

export class RecipeDto {
  recipeKey: string;
  name: string;
  description?: string;
  version?: number;
  steps: RecipeStepDto[];
  inputSchema?: Record<string, unknown>;
  outputTemplate?: unknown;
  confirmation?: ActionConfirmation;
  enabled?: boolean;
}

export class RecipeExecuteDto {
  recipeKey: string;
  input?: Record<string, unknown>;
  confirmed?: boolean;
  dryRun?: boolean;
}

export class RecipeDeleteDto {
  recipeKey: string;
}
