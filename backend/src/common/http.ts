import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError, isAppError } from './app-error.js';
import type { Logger } from './logger.js';

/** Parses `data` with a zod schema, converting failures into a VALIDATION_FAILED AppError. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const first = details[0];
    throw new AppError(
      'VALIDATION_FAILED',
      first
        ? `Invalid request: ${first.path ? `${first.path}: ` : ''}${first.message}`
        : 'Invalid request.',
      { details },
    );
  }
  return result.data;
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value)
    throw new AppError('VALIDATION_FAILED', `Missing parameter ${name}.`);
  return value;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(new AppError('NOT_FOUND', 'Endpoint not found.').toBody());
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    if (isAppError(err)) {
      if (err.status >= 500)
        logger.error('request failed', { path: req.path, code: err.code, err, cause: err.cause });
      if (err.retryAt)
        res.setHeader(
          'Retry-After',
          Math.max(1, Math.ceil((err.retryAt.getTime() - Date.now()) / 1000)),
        );
      res.status(err.status).json(err.toBody());
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
      res
        .status(400)
        .json(new AppError('VALIDATION_FAILED', 'Request body is not valid JSON.').toBody());
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
      res
        .status(413)
        .json(
          new AppError('VALIDATION_FAILED', 'Request body is too large.', { status: 413 }).toBody(),
        );
      return;
    }
    logger.error('unhandled error', { path: req.path, err });
    res
      .status(500)
      .json(
        new AppError('INTERNAL', 'Something went wrong on our side. Please try again.').toBody(),
      );
  };
}
