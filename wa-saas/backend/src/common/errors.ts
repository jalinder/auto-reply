import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/** Stable, client-safe error. Never put secrets, stack traces or provider payloads in message. */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  unauthorized: () => new AppError('UNAUTHORIZED', 'Sign in to continue.', 401),
  forbidden: (msg = 'You do not have permission to do this.') => new AppError('FORBIDDEN', msg, 403),
  notFound: (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`, 404),
  conflict: (code: string, msg: string) => new AppError(code, msg, 409),
  stepUpRequired: () => new AppError('STEP_UP_REQUIRED', 'Confirm your password to continue.', 403),
  planLimit: (msg: string) => new AppError('PLAN_LIMIT_REACHED', msg, 402),
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? 'req_unknown';

    let status = 500;
    let body: { code: string; message: string; details?: unknown } = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Try again in a moment.',
    };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as any;
      const message = Array.isArray(r?.message) ? r.message.join('; ') : r?.message ?? exception.message;
      const code =
        status === 400 ? 'VALIDATION_FAILED' :
        status === 401 ? 'UNAUTHORIZED' :
        status === 403 ? 'FORBIDDEN' :
        status === 404 ? 'NOT_FOUND' :
        status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
      body = { code, message: status === 429 ? 'Too many requests. Slow down and try again shortly.' : message };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = 409;
      body = { code: 'DUPLICATE', message: 'A record with these details already exists.' };
    } else {
      this.logger.error({ requestId, err: (exception as Error)?.message, stack: (exception as Error)?.stack });
    }

    res.status(status).json({ error: { ...body, requestId } });
  }
}
