import { MetaGraphErrorBody } from './types/meta-response.types';

export class MetaCloudGraphError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
    public readonly graphCode = 100,
    public readonly graphType = 'GraphMethodException',
  ) {
    super(message);
    this.name = 'MetaCloudGraphError';
  }

  public toBody(): MetaGraphErrorBody {
    return {
      error: {
        message: this.message,
        type: this.graphType,
        code: this.graphCode,
      },
    };
  }
}

export const invalidOAuthToken = () =>
  new MetaCloudGraphError(401, 'Invalid OAuth access token.', 190, 'OAuthException');
