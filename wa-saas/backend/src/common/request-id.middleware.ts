import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[a-zA-Z0-9_-]{8,64}$/.test(incoming) ? incoming : `req_${randomBytes(9).toString('base64url')}`;
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
