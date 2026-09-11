import { HttpStatus } from '@utils/http-status';

export class UnauthorizedException {
  constructor(...objectError: any[]) {
    throw {
      status: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      message: objectError.length > 0 ? objectError : 'Unauthorized',
    };
  }
}
